import { BaseClient } from "@evex/linejs/base";
import { BaseStorage, type Storage } from "@evex/linejs/storage";
import { Client } from "@evex/linejs";
import { decryptJson, encryptJson, hashForAudit } from "./crypto";
import type { AccountAction, Env } from "./types";

type State = Record<string, Storage["Value"]>;
type Draft = { chatMid: string; text: string; actor: string; expiresAt: number; used: boolean };
type Audit = { at: number; actor: string; action: string; chatHash?: string; textLength?: number; result: "ok" | "error" };

class DurableStorage extends BaseStorage {
	constructor(private readonly state: DurableObjectStorage, private readonly secret: string) {
		super();
	}

	private async all(): Promise<State> {
		const stored = await this.state.get<string>("line-state");
		return stored ? decryptJson<State>(this.secret, stored) : {};
	}
	private async save(value: State): Promise<void> {
		await this.state.put("line-state", await encryptJson(this.secret, value));
	}
	async set(key: Storage["Key"], value: Storage["Value"]): Promise<void> {
		const all = await this.all();
		all[key] = value;
		await this.save(all);
	}
	async get(key: Storage["Key"]): Promise<Storage["Value"] | undefined> {
		return (await this.all())[key];
	}
	async delete(key: Storage["Key"]): Promise<void> {
		const all = await this.all();
		delete all[key];
		await this.save(all);
	}
	async clear(): Promise<void> { await this.state.delete("line-state"); }
	async migrate(storage: BaseStorage): Promise<void> {
		for (const [key, value] of Object.entries(await this.all())) await storage.set(key, value);
	}
}

export class LineAccount implements DurableObject {
	constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/admin/login/stream") return this.loginStream();
		if (request.method !== "POST") return Response.json({ error: "Not found" }, { status: 404 });
		try {
			const action = await request.json<AccountAction>();
			return Response.json(await this.dispatch(action));
		} catch (error) {
			return Response.json({ error: this.safeError(error) }, { status: 400 });
		}
	}

	private storage(): DurableStorage { return new DurableStorage(this.ctx.storage, this.env.LINE_STATE_ENCRYPTION_KEY); }
	private async client(requireLogin = true): Promise<Client> {
		const storage = this.storage();
		const base = new BaseClient({ device: "DESKTOPWIN", storage });
		base.on("update:authtoken", (token) => storage.set(".auth", token));
		const token = await storage.get(".auth");
		if (typeof token !== "string") {
			if (requireLogin) throw new Error("LINE is not authenticated. Complete QR login in /admin/login.");
			return new Client(base);
		}
		await base.loginProcess.login({ authToken: token });
		return new Client(base);
	}

	private async dispatch(action: AccountAction): Promise<unknown> {
		switch (action.action) {
			case "status": return this.status();
			case "list_chats": return this.listChats(action.limit);
			case "recent_messages": return this.recentMessages(action.chatMid, action.limit);
			case "prepare": return this.prepare(action.chatMid, action.text, action.actor);
			case "send": return this.send(action.confirmationToken, action.actor);
		}
	}

	private async status() {
		const token = await this.storage().get(".auth");
		if (typeof token !== "string") return { authenticated: false };
		try {
			const client = await this.client();
			const profile = await client.getMyProfile();
			return { authenticated: true, displayName: profile.displayName, mid: profile.mid };
		} catch { return { authenticated: false, reauthenticate: true }; }
	}
	private async listChats(limit: number) {
		const chats = await (await this.client()).fetchJoinedChats();
		return chats.slice(0, limit).map((chat) => ({ mid: chat.mid, name: chat.name, type: chat.raw.type }));
	}
	private async recentMessages(chatMid: string, limit: number) {
		const messages = await (await this.client()).getChat(chatMid).then((chat) => chat.fetchMessages(limit));
		return messages.map((message) => ({
			id: message.raw.id,
			text: message.raw.text ?? null,
			contentType: message.raw.contentType,
			createdAt: String(message.raw.createdTime ?? ""),
			from: message.raw.from,
			to: message.raw.to,
		}));
	}
	private async prepare(chatMid: string, text: string, actor: string) {
		const token = crypto.randomUUID();
		const draft: Draft = { chatMid, text, actor, expiresAt: Date.now() + 5 * 60_000, used: false };
		await this.ctx.storage.put(`draft:${token}`, await encryptJson(this.env.LINE_STATE_ENCRYPTION_KEY, draft));
		return { confirmation_token: token, chat_mid: chatMid, text, expires_at: new Date(draft.expiresAt).toISOString() };
	}
	private async send(token: string, actor: string) {
		const key = `draft:${token}`;
		const encrypted = await this.ctx.storage.get<string>(key);
		if (!encrypted) throw new Error("Confirmation token is invalid or already used.");
		const draft = await decryptJson<Draft>(this.env.LINE_STATE_ENCRYPTION_KEY, encrypted);
		if (draft.used || draft.actor !== actor || draft.expiresAt < Date.now()) {
			await this.ctx.storage.delete(key);
			throw new Error("Confirmation token is invalid, expired, or belongs to another user.");
		}
		const sends = (await this.ctx.storage.get<number[]>("send-timestamps")) ?? [];
		const recent = sends.filter((at) => at > Date.now() - 10 * 60_000);
		if (recent.length >= 20) throw new Error("Send rate limit reached. Try again later.");
		await this.ctx.storage.delete(key);
		try {
			const sent = await (await this.client()).getChat(draft.chatMid).then((chat) => chat.sendMessage({ text: draft.text, e2ee: true }));
			recent.push(Date.now());
			await this.ctx.storage.put("send-timestamps", recent);
			await this.audit({ actor, action: "send", chatHash: await hashForAudit(draft.chatMid), textLength: draft.text.length, result: "ok" });
			return { message_id: sent.raw.id, chat_mid: draft.chatMid, sent: true };
		} catch (error) {
			await this.audit({ actor, action: "send", chatHash: await hashForAudit(draft.chatMid), textLength: draft.text.length, result: "error" });
			throw error;
		}
	}
	private async audit(entry: Omit<Audit, "at">): Promise<void> {
		const entries = ((await this.ctx.storage.get<Audit[]>("audit")) ?? []).filter((item) => item.at > Date.now() - 30 * 86_400_000);
		entries.push({ ...entry, at: Date.now() });
		await this.ctx.storage.put("audit", entries.slice(-500));
	}
	private loginStream(): Response {
		const stream = new TransformStream();
		const writer = stream.writable.getWriter();
		const emit = async (event: string, data: unknown) => writer.write(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
		this.ctx.waitUntil((async () => {
			try {
				const base = new BaseClient({ device: "DESKTOPWIN", storage: this.storage() });
				base.on("qrcall", (url) => emit("qr", { url }));
				base.on("pincall", (pin) => emit("pin", { pin }));
				base.on("update:authtoken", (token) => this.storage().set(".auth", token));
				await base.loginProcess.withQrCode();
				await base.loginProcess.ready();
				await emit("complete", { ok: true });
			} catch (error) { await emit("error", { message: this.safeError(error) }); }
			finally { await writer.close(); }
		})());
		return new Response(stream.readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
	}
	private safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : "LINE operation failed"; }
}
