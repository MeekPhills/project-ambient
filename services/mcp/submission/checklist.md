# OpenAI public plugin submission checklist

The code and listing materials are review-ready. Public submission remains gated by publisher identity, portal access, domain verification, and replacing the private-alpha bearer token with user-facing OAuth 2.1.

- [x] Tool-only architecture: no unnecessary widget or remote image domain.
- [x] Stable Streamable HTTP endpoint at `/mcp` plus `/health` and `/ready`.
- [x] One recognizable user goal per tool.
- [x] Explicit input and output schemas, accurate impact annotations, concise structured output.
- [x] State changes require `confirmation: "confirmed"` and a 16–128 character `request_id`.
- [x] Retried mutations are idempotent at the local/demo adapter boundary.
- [x] No tool accepts arbitrary URLs, paths, shell text, credentials, or media bytes.
- [x] Six positive and four negative evaluation fixtures.
- [x] Deterministic review adapter with synthetic content.
- [x] JSON request logs exclude bearer tokens, local paths, and media.
- [x] Replace listing, repository, policy, support, and MCP URLs with production values.
- [x] Host `/mcp` on dependable public HTTPS infrastructure; do not submit a tunnel.
- [ ] Replace alpha bearer authentication with OAuth 2.1 + PKCE and publish protected-resource metadata.
- [ ] Verify publisher organization, domain, Owner role, and Apps Management write access.
- [x] Publish privacy policy, terms, support page, website, and production-ready 1024 px logo.
- [ ] Run all evals against the production endpoint in ChatGPT Developer Mode.
- [ ] Refresh the plugin after descriptor changes and verify all tool annotations in the dashboard.
- [ ] Submit through the OpenAI Platform dashboard and monitor review status.

Official implementation references:

- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/plan/tools
- https://developers.openai.com/plugins/quickstart
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/app-guidelines
