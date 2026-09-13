import { isRouteErrorResponse } from "react-router";

/**
 * Layout-level error classification for `app/routes/app.tsx` (#idle-500, app
 * issue #29 — Shopify review 2026-09-11, Req 2.1.1).
 *
 * A thrown `Response` / route error response is React Router or Shopify CONTROL
 * FLOW (the session-token bounce, a redirect, a 4xx) and must keep flowing to the
 * SDK's `boundary.error`, which renders the bounce document with the headers
 * Shopify needs to keep the app embedded. Anything else — an aborted or dropped
 * single-fetch revalidation (`AbortError`), a network failure, an undecodable
 * body, a thrown `Error` — is a transient failure that must recover IN-FRAME and
 * never become the root "500 Something went wrong" page.
 */
export function isRouteControlFlow(error: unknown): boolean {
  return error instanceof Response || isRouteErrorResponse(error);
}

/**
 * Retry for the layout boundary: a plain document reload of the embedded frame.
 * The frame URL carries `shop`/`host`/`embedded`, so the SDK's embedded document
 * path re-enters its session-token bounce and mints a FRESH token — a client-side
 * `navigate(".")` would run inside a document whose App Bridge provider is gone
 * (the layout that mounts it is the route that errored). Injected for tests.
 */
export function reloadEmbeddedFrame(win: Pick<Window, "location"> | undefined = typeof window === "undefined" ? undefined : window): void {
  win?.location.reload();
}
