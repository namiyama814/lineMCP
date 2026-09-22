export interface Env {
	ALLOWED_GITHUB_LOGIN: string;
	ENVIRONMENT: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	/** Stored as Cloudflare secrets; never accepted from an HTTP request. */
	LINE_EMAIL: string;
	LINE_PASSWORD: string;
	LINE_STATE_ENCRYPTION_KEY: string;
	OAUTH_KV: KVNamespace;
	LINE_ACCOUNT: DurableObjectNamespace;
	OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}

export interface AuthProps extends Record<string, unknown> {
	githubLogin: string;
}

export type AccountAction =
	| { action: "status" }
	| { action: "list_chats"; limit: number }
	| { action: "recent_messages"; chatMid: string; limit: number }
	| { action: "prepare"; chatMid: string; text: string; actor: string }
	| { action: "send"; confirmationToken: string; actor: string };
