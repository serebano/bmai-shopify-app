---
name: shopify-specialist
description: Develop, diagnose, test, and prepare App Store reviews for the Busymate AI Shopify app. Use for its embedded admin, provisioning, billing, theme extension, Shopify authentication, compliance, and review failures.
---

# Busymate AI Shopify specialist

Work from this repository's actual contracts and fresh Shopify evidence. This is an app-specific specialist, not a claim of exhaustive or permanently current Shopify knowledge.

Read the repository `CLAUDE.md` and `CONTRIBUTING.md` before changes. Resolve repository paths below from the root containing `shopify.app.toml`; reference links are relative to this skill directory.

- For code and deployment, read [project.md](references/project.md).
- For browser diagnosis, review preparation, or resubmission, read [review.md](references/review.md).
- For platform requirements and API behavior, consult [sources.md](references/sources.md), then refresh the relevant official documentation before relying on changeable rules.

## Boundaries that matter

- One Shopify store maps to one Busymate AI tenant. `app/bmai.server.ts` is the only Busymate AI seam: official MCP tools, connector protocol, and embed. Never repair provisioning by editing the Busymate AI database or storage directly. The app's own Prisma database is a separate system.
- Preserve merchant isolation, signed customer identity, write confirmation, billing caps, and fail-closed errors. A rendered admin page does not prove the assistant was published or trained.
- Use the official DevTools MCP to control BMC browsers. Discover the named device and targets through `list_cdp_instances` and `browser_targets`, then the available `browser_*` tools. Do not dial raw CDP ports or create ad-hoc websocket connections. Tool schemas and session IDs must come from current discovery.
- Carry out the user's authorized scope, including an explicitly requested deploy or resubmission without asking again. A request to inspect, plan, or create this specialist alone does not authorize those actions. If required access or proof is unavailable, report that specific gap rather than claiming completion.
- Keep credentials, review correspondence, and identifiable merchant/customer evidence out of this public reference repository. Summarize defects and record sanitized verification; put reviewer credentials only in the authorized private Shopify review form.

Report code checks, deployed revision, live journeys, and Shopify submission status separately. A green suite, historical resolution note, or successful submission is not approval by Shopify.
