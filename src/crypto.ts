const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
	let value = "";
	for (const byte of bytes) value += String.fromCharCode(byte);
	return btoa(value);
}

function base64ToBytes(value: string): Uint8Array {
	const raw = atob(value);
	return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function importEncryptionKey(secret: string): Promise<CryptoKey> {
	const material = base64ToBytes(secret);
	if (material.byteLength !== 32) {
		throw new Error("LINE_STATE_ENCRYPTION_KEY must be a base64 encoded 32-byte key");
	}
	return crypto.subtle.importKey("raw", asArrayBuffer(material), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptJson(secret: string, value: unknown): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await importEncryptionKey(secret);
	const plaintext = encoder.encode(JSON.stringify(value));
	const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, asArrayBuffer(plaintext));
	return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptJson<T>(secret: string, payload: string): Promise<T> {
	const [encodedIv, encodedCiphertext] = payload.split(".");
	if (!encodedIv || !encodedCiphertext) throw new Error("Malformed encrypted state");
	const key = await importEncryptionKey(secret);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: asArrayBuffer(base64ToBytes(encodedIv)) },
		key,
		asArrayBuffer(base64ToBytes(encodedCiphertext)),
	);
	return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function hashForAudit(value: string): Promise<string> {
	const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
	return bytesToBase64(new Uint8Array(bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
