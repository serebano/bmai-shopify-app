import { isRouteErrorResponse, type ClientActionFunctionArgs } from "react-router";

/**
 * Fail-closed CLIENT side of every embedded-admin action (#retrain-500, part 2).
 *
 * WHY THIS EXISTS — traced live on 2026-09-02 (busymate-devtools#2110): a merchant
 * clicks "Re-train on my store", the fetcher POSTs `/app/connector.data`, and the
 * request dies in transit (Chrome `net::ERR_NETWORK_CHANGED` — an interface flap,
 * a Wi-Fi blip, a proxy, or the app restarting behind nginx = 502). App Bridge's
 * fetch wrapper rejects with `TypeError: Failed to fetch`, and React Router turns
 * a REJECTED action fetch into a ROUTE ERROR: it bubbles to the nearest
 * ErrorBoundary — in this app the root one — and the merchant sees the branded
 * "500 Something went wrong" page inside the Shopify admin iframe while the
 * server-side action may well have SUCCEEDED (the host logged the re-train). A
 * Shopify reviewer reads that as Req 2.1.1 / 2.1.3 (no web 500s).
 *
 * The server action already fails closed (`connectorAction.server.ts`). This is
 * the matching client seam: `serverAction()` is the single-fetch call; when it
 * rejects for a TRANSPORT reason we resolve to `{ ok:false, error, transport:true }`
 * so the route's existing toast/banner renders an error and the page stays in the
 * frame. Thrown Responses (redirects, Shopify's session-token bounce, 4xx route
 * errors) are React Router / Shopify CONTROL FLOW and are re-thrown untouched.
 *
 * Every `app/routes/app.*.tsx` with an `action` MUST export
 * `clientAction = failClosedClientAction` (test/clientAction.test.ts derives that
 * list from the live route files).
 */
export interface TransportFailure {
  intent: string;
  ok: false;
  state: "failed";
  error: string;
  /** True when the failure was the request itself, not the server's verdict — the
   *  server may have completed the work, so the UI should revalidate. */
  transport: true;
}

const NETWORK = /failed to fetch|networkerror|network error|load failed|network changed|ERR_NETWORK|ERR_INTERNET|ERR_CONNECTION|fetch failed/i;
const DECODE = /turbo-stream|unable to decode|unexpected token|unexpected end of json|not valid json/i;

/** Merchant-facing text for a failed request. Never a stack, never a developer hint. */
export function describeTransportError(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (NETWORK.test(msg)) {
    return "Network error — the connection dropped or changed before the app could confirm the result. The page has been refreshed to show the real state; please try again.";
  }
  if (DECODE.test(msg)) {
    return "The app did not receive a valid response (it may be restarting). Please try again in a moment.";
  }
  return msg || "Something went wrong. Please try again.";
}

/** Read the submitted `intent` without consuming the request React Router still needs. */
async function readIntent(request: Request): Promise<string> {
  try {
    const form = await request.clone().formData();
    return String(form.get("intent") ?? "");
  } catch {
    return "";
  }
}

/** Only the two members we use — keeps the helper assignable as a route `clientAction` and trivially testable. */
export type FailClosedClientActionArgs = Pick<ClientActionFunctionArgs, "request" | "serverAction">;

export async function failClosedClientAction({ request, serverAction }: FailClosedClientActionArgs): Promise<unknown> {
  const intent = await readIntent(request);
  try {
    return await serverAction();
  } catch (err) {
    if (err instanceof Response || isRouteErrorResponse(err)) throw err;
    const failure: TransportFailure = { intent, ok: false, state: "failed", error: describeTransportError(err), transport: true };
    return failure;
  }
}

/** Type guard for the UI: did the request itself fail (so the server state is unknown)? */
export function isTransportFailure(data: unknown): data is TransportFailure {
  return typeof data === "object" && data !== null && (data as { transport?: unknown }).transport === true && (data as { ok?: unknown }).ok === false;
}
