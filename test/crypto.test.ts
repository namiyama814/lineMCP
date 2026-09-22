import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, importEncryptionKey } from "../src/crypto";

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("encrypted LINE state", () => {
	it("round-trips JSON without exposing plaintext", async () => {
		const value = { authToken: "secret-token", nested: { key: "secret-key" } };
		const encrypted = await encryptJson(key, value);
		expect(encrypted).not.toContain("secret-token");
		expect(await decryptJson<typeof value>(key, encrypted)).toEqual(value);
	});

	it("rejects malformed keys and ciphertext", async () => {
		await expect(importEncryptionKey("not-base64")).rejects.toThrow();
		await expect(decryptJson(key, "not-a-payload")).rejects.toThrow();
	});
});
