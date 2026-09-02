import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scheduleReingest } from "../lib/ingest";
import { handleScopesUpdate } from "../lib/scopesUpdate";

// A scope grant keeps the existing offline session (no afterAuth), so this is
// where an existing store's assistant learns it can now read more: record the
// scopes and queue a re-train (app/lib/scopesUpdate.ts).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, payload } = await authenticate.webhook(request);
  const out = await handleScopesUpdate(
    { shop, sessionId: session?.id ?? null, current: (payload as { current?: unknown } | null)?.current },
    {
      updateSessionScope: async (id, scope) => {
        await prisma.session.update({ where: { id }, data: { scope } });
      },
      scheduleReingest,
    },
  );
  console.log(
    `[scopes] ${shop}: ${out.scope ?? "(payload had no scopes)"}${out.sessionUpdated ? " (session updated)" : ""} → re-train ${
      out.retrain.scheduled ? "queued" : `skipped: ${out.retrain.reason}`
    }`,
  );
  return new Response();
};
