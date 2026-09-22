import { AuthorizationError, OAuthProvider, type AuthRequest, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createLineMcpHandler } from "./mcp";
import type { AuthProps, Env } from "./types";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

type PendingAuthorization = { search: string };
type GitHubUser = { login: string; id: number };

export class McpApiHandler extends WorkerEntrypoint<Env, AuthProps> {
	async fetch(request: Request): Promise<Response> {
		return createLineMcpHandler(this.env, this.ctx.props).fetch(request);
	}
}

function origin(request: Request): string { return new URL(request.url).origin; }

async function parseAuthorization(request: Request, helpers: OAuthHelpers): Promise<AuthRequest | Response> {
	try { return await helpers.parseAuthRequest(request); }
	catch (error) {
		if (!(error instanceof AuthorizationError)) throw error;
		if (!error.redirectUri) return new Response(error.description, { status: 400 });
		const redirect = new URL(error.redirectUri);
		redirect.searchParams.set("error", error.code);
		redirect.searchParams.set("error_description", error.description);
		if (error.state) redirect.searchParams.set("state", error.state);
		if (error.issuer) redirect.searchParams.set("iss", error.issuer);
		return Response.redirect(redirect, 302);
	}
}

export const oauthProvider = new OAuthProvider<Env>({
	apiRoute: "/mcp",
	apiHandler: McpApiHandler,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	scopesSupported: ["line:read", "line:send"],
	clientIdMetadataDocumentEnabled: true,
	defaultHandler: {
		async fetch(request, env): Promise<Response> {
			const url = new URL(request.url);
			if (url.pathname === "/authorize") {
				const parsed = await parseAuthorization(request, env.OAUTH_PROVIDER);
				if (parsed instanceof Response) return parsed;
				const state = crypto.randomUUID();
				await env.OAUTH_KV.put(`mcp-auth:${state}`, JSON.stringify({ search: url.search } satisfies PendingAuthorization), { expirationTtl: 600 });
				const github = new URL(GITHUB_AUTH_URL);
				github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
				github.searchParams.set("redirect_uri", `${origin(request)}/oauth/github/callback`);
				github.searchParams.set("scope", "read:user");
				github.searchParams.set("state", state);
				return Response.redirect(github, 302);
			}
			if (url.pathname === "/oauth/github/callback") return githubCallback(request, env);
			return new Response("Not found", { status: 404 });
		},
	},
});

async function githubCallback(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const state = url.searchParams.get("state");
	const code = url.searchParams.get("code");
	if (!state || !code) return new Response("Missing GitHub OAuth response", { status: 400 });
	const pending = await env.OAUTH_KV.get<PendingAuthorization>(`mcp-auth:${state}`, "json");
	const adminLogin = await env.OAUTH_KV.get(`admin-auth:${state}`);
	await env.OAUTH_KV.delete(`mcp-auth:${state}`);
	await env.OAUTH_KV.delete(`admin-auth:${state}`);
	if (!pending && !adminLogin) return new Response("GitHub authorization session expired", { status: 400 });
	const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json" },
		body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
	});
	const token = await tokenResponse.json<{ access_token?: string }>();
	if (!tokenResponse.ok || !token.access_token) return new Response("GitHub token exchange failed", { status: 401 });
	const userResponse = await fetch(GITHUB_USER_URL, { headers: { authorization: `Bearer ${token.access_token}`, "user-agent": "line-mcp" } });
	const user = await userResponse.json<GitHubUser>();
	if (!userResponse.ok || user.login !== env.ALLOWED_GITHUB_LOGIN) return new Response("This GitHub user is not allowed to access this MCP server", { status: 403 });
	if (adminLogin) {
		const session = crypto.randomUUID();
		await env.OAUTH_KV.put(`admin-session:${session}`, user.login, { expirationTtl: 600 });
		return new Response(null, {
			status: 302,
			headers: {
				location: "/admin/login",
				"set-cookie": `line_mcp_admin=${session}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
			},
		});
	}
	if (!pending) return new Response("GitHub authorization session expired", { status: 400 });
	const original = new URL(`${origin(request)}/authorize${pending.search}`);
	const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(original));
	const completed = await env.OAUTH_PROVIDER.completeAuthorization({
		request: authRequest,
		userId: `github-${user.id}`,
		scope: authRequest.scope.filter((scope) => scope === "line:read" || scope === "line:send"),
		metadata: { githubLogin: user.login },
		props: { githubLogin: user.login } satisfies AuthProps,
	});
	return Response.redirect(completed.redirectTo, 302);
}
