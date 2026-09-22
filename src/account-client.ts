import type { AccountAction, Env } from "./types";

export async function callAccount(env: Env, action: AccountAction): Promise<unknown> {
	const id = env.LINE_ACCOUNT.idFromName("primary");
	const response = await env.LINE_ACCOUNT.get(id).fetch("https://line-account/internal", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(action),
	});
	const payload = await response.json<unknown>();
	if (!response.ok) {
		const message = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : "LINE request failed";
		throw new Error(message);
	}
	return payload;
}

export async function accountFetch(env: Env, request: Request): Promise<Response> {
	return env.LINE_ACCOUNT.get(env.LINE_ACCOUNT.idFromName("primary")).fetch(request);
}
