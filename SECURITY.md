# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report vulnerabilities privately to **security@busymate.ai**, or via GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
(Security → Report a vulnerability) on this repository.

Please include: a description, reproduction steps, affected version/commit, and impact.
We aim to acknowledge within a few business days.

## Scope & handling secrets

This repository is a reference implementation. It contains **no secrets**: `.env` is
gitignored and only `.env.example` (placeholders) is committed. When you run or fork it,
keep all real values — Shopify API secret, `DATABASE_URL`, the Busymate AI proof secret,
provisioning refresh tokens, the ES256 launch key, and `BMAI_SUPPORT_ACTOR_MASTER` — in
your own secret store or host environment. **Never commit a real credential.**

If you believe a secret was committed anywhere in this repo or its history, please report
it privately as above so it can be rotated and scrubbed.

## Design notes relevant to security

- **all-ops-via-MCP** — the app never writes to the Busymate AI control plane directly.
- **Fail-closed** — a missing/short actor-token master, a bad signature, or an unknown
  `(tenant, connector)` refuses the request; delegated writes are never downgraded to an
  unverified path.
- Webhook and App-Proxy requests are **HMAC-verified**; delegated connector calls verify a
  short-lived signed actor token with issuer/audience/kid/TTL pins.
