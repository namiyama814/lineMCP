import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { callAccount } from "./account-client";
import type { AuthProps, Env } from "./types";

function result(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
	const message = error instanceof Error ? error.message : "LINE operation failed";
	return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

export function createLineMcpHandler(env: Env, props: AuthProps) {
	return createMcpHandler(() => {
		const server = new McpServer({ name: "line-mcp", version: "0.1.0" });
		server.registerTool("line_account_status", {
			description: "Return whether the configured LINE account is authenticated. Never returns credentials.",
			inputSchema: {},
		}, async () => {
			try { return result(await callAccount(env, { action: "status" })); } catch (error) { return errorResult(error); }
		});
		server.registerTool("line_list_chats", {
			description: "List normal LINE chats available to the configured account. Use a returned MID with message tools.",
			inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
		}, async ({ limit }) => {
			try { return result(await callAccount(env, { action: "list_chats", limit })); } catch (error) { return errorResult(error); }
		});
		server.registerTool("line_get_recent_messages", {
			description: "Get recent messages from one normal LINE chat. Text is returned only for text messages; attachment contents are never downloaded.",
			inputSchema: { chat_mid: z.string().min(1), limit: z.number().int().min(1).max(100).default(20) },
		}, async ({ chat_mid, limit }) => {
			try { return result(await callAccount(env, { action: "recent_messages", chatMid: chat_mid, limit })); } catch (error) { return errorResult(error); }
		});
		server.registerTool("line_prepare_text_message", {
			description: "Create a text-message preview and a one-time confirmation token. This does not send the message. The token expires in five minutes and belongs only to the current GitHub user.",
			inputSchema: { chat_mid: z.string().min(1), text: z.string().min(1).max(5000) },
		}, async ({ chat_mid, text }) => {
			try { return result(await callAccount(env, { action: "prepare", chatMid: chat_mid, text, actor: props.githubLogin })); } catch (error) { return errorResult(error); }
		});
		server.registerTool("line_send_prepared_message", {
			description: "Send exactly one text message prepared by line_prepare_text_message. Requires its unexpired, one-time confirmation token.",
			inputSchema: { confirmation_token: z.string().uuid() },
		}, async ({ confirmation_token }) => {
			try { return result(await callAccount(env, { action: "send", confirmationToken: confirmation_token, actor: props.githubLogin })); } catch (error) { return errorResult(error); }
		});
		return server;
	}, { route: "/mcp", authContext: { props } });
}
