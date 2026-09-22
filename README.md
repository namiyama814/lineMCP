# lineMCP

Personal, single-account LINE MCP server for Cloudflare Workers. It uses
[`linejs`](https://github.com/evex-dev/linejs) and is intentionally restricted
to an allowlisted GitHub user.

## Included tools

- `line_account_status`
- `line_list_chats`
- `line_get_recent_messages`
- `line_prepare_text_message`
- `line_send_prepared_message`

Messages are text-only. Sending is always a two-step operation: prepare a
draft, then consume its five-minute, one-time confirmation token.

## First deployment

1. The required dedicated KV namespaces are already configured in
   `wrangler.jsonc`; do not reuse them for another application.
2. Create a GitHub OAuth App. Its callback URL is
   `https://<worker-domain>/oauth/github/callback`; the same app also secures
   `/admin/login`.
3. Copy `.dev.vars.example` to `.dev.vars` for local development. For each
   Cloudflare environment, set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and
   `LINE_STATE_ENCRYPTION_KEY` using `wrangler secret put`.
4. Run `npm install` and `npm run check`. Cloudflare deployment is performed
   through the Cloudflare MCP, not GitHub Actions.
5. Open `https://<worker-domain>/admin/login`, authenticate with the allowlisted
   GitHub user, and scan the displayed LINE QR code. Do not expose this URL to
   untrusted users.

Connect an MCP client to `https://<worker-domain>/mcp`. The server publishes
OAuth discovery endpoints automatically; authorize with the configured GitHub
account.

## Operations and security

- LINE credentials, QR certificates, and E2EE state are encrypted with
  `LINE_STATE_ENCRYPTION_KEY` inside the single Durable Object.
- Only audit metadata is stored: action, actor, time, hashed chat ID, text
  length, and outcome. Message bodies and credentials are not logged.
- The send limit is 20 messages per 10 minutes. Confirmation tokens are bound
  to the GitHub user and cannot be reused.
- `linejs` is a SelfBot library. Use only an account you control and review
  LINE's current terms and account-risk implications before deploying.
