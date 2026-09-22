import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "../src/crypto";
import { LineAccount } from "../src/line-account";

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

class MemoryStorage {
	values = new Map<string, unknown>();
	async get<T>(name: string): Promise<T | undefined> { return this.values.get(name) as T | undefined; }
	async put<T>(name: string, value: T): Promise<void> { this.values.set(name, value); }
	async delete(name: string): Promise<boolean> { return this.values.delete(name); }
}

function account() {
	const storage = new MemoryStorage();
	return {
		storage,
		account: new LineAccount({ storage, waitUntil() {} } as never, { LINE_STATE_ENCRYPTION_KEY: key } as never),
	};
}

describe("send confirmation state", () => {
	it("does not start password login when credential secrets are absent", async () => {
		const { account: instance } = account();
		const response = await instance.fetch(new Request("https://do/admin/login/stream?method=password"));
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ error: expect.stringContaining("LINE_EMAIL") });
	});

	it("creates an encrypted, one-time draft", async () => {
		const { account: instance, storage } = account();
		const response = await instance.fetch(new Request("https://do/internal", { method: "POST", body: JSON.stringify({ action: "prepare", chatMid: "c123", text: "hello", actor: "octocat" }) }));
		const prepared = await response.json<{ confirmation_token: string }>();
		const encrypted = await storage.get<string>(`draft:${prepared.confirmation_token}`);
		expect(encrypted).not.toContain("hello");
		expect(await decryptJson<{ text: string }>(key, encrypted!)).toMatchObject({ text: "hello" });
	});

	it("rejects and deletes an expired confirmation before any LINE call", async () => {
		const { account: instance, storage } = account();
		await storage.put("draft:00000000-0000-4000-8000-000000000000", await encryptJson(key, { chatMid: "c123", text: "hello", actor: "octocat", expiresAt: 0, used: false }));
		const response = await instance.fetch(new Request("https://do/internal", { method: "POST", body: JSON.stringify({ action: "send", confirmationToken: "00000000-0000-4000-8000-000000000000", actor: "octocat" }) }));
		expect(response.status).toBe(400);
		expect(await storage.get("draft:00000000-0000-4000-8000-000000000000")).toBeUndefined();
	});
});
