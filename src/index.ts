import { accountFetch } from "./account-client";
import { LineAccount } from "./line-account";
import { oauthProvider } from "./oauth";
import type { Env } from "./types";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";

export { LineAccount };

function cookie(request: Request, name: string): string | undefined {
	return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function allowedAdmin(request: Request, env: Env): Promise<boolean> {
	const session = cookie(request, "line_mcp_admin");
	if (!session) return false;
	return (await env.OAUTH_KV.get(`admin-session:${session}`)) === env.ALLOWED_GITHUB_LOGIN;
}

function adminPage(): Response {
	return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>LINE MCP login</title><style>body{font:16px system-ui;max-width:44rem;margin:3rem auto;padding:0 1rem}img{max-width:20rem}pre{white-space:pre-wrap;color:#444}</style><h1>LINE MCP: QR ログイン</h1><p>この画面を開いたまま、表示される QR コードを本人の LINE アプリで読み取ってください。</p><div id="status">接続しています…</div><img id="qr" hidden alt="LINE QR code"><pre id="detail"></pre><script>const status=document.querySelector('#status'),qr=document.querySelector('#qr'),detail=document.querySelector('#detail');const events=new EventSource('/admin/login/stream');events.addEventListener('qr',e=>{const d=JSON.parse(e.data);qr.src=d.url;qr.hidden=false;status.textContent='QR コードを読み取ってください';});events.addEventListener('pin',e=>{status.textContent='LINE アプリで PIN を確認してください';detail.textContent=JSON.parse(e.data).pin;});events.addEventListener('complete',()=>{status.textContent='ログインが完了しました。この画面を閉じて MCP を接続できます。';events.close();});events.addEventListener('error',e=>{status.textContent='ログインに失敗しました。再読み込みして再試行してください。';detail.textContent=e.data||'';events.close();});</script></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function adminHandler(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/admin/github") {
		const state = crypto.randomUUID();
		await env.OAUTH_KV.put(`admin-auth:${state}`, "1", { expirationTtl: 600 });
		const github = new URL(GITHUB_AUTH_URL);
		github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
		github.searchParams.set("redirect_uri", `${url.origin}/oauth/github/callback`);
		github.searchParams.set("scope", "read:user");
		github.searchParams.set("state", state);
		return Response.redirect(github, 302);
	}
	if (!(await allowedAdmin(request, env))) return Response.redirect(new URL("/admin/github", url), 302);
	if (url.pathname === "/admin/login") return adminPage();
	if (url.pathname === "/admin/login/stream") return accountFetch(env, new Request("https://line-account/admin/login/stream"));
	return new Response("Not found", { status: 404 });
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const pathname = new URL(request.url).pathname;
		if (pathname === "/mcp" || pathname.startsWith("/.well-known/") || pathname === "/authorize" || pathname === "/token" || pathname === "/register" || pathname === "/oauth/github/callback") return oauthProvider.fetch(request, env, ctx);
		if (pathname.startsWith("/admin/")) return adminHandler(request, env);
		return Response.json({ name: "line-mcp", mcp: "/mcp", admin: "/admin/login" });
	},
} satisfies ExportedHandler<Env>;
