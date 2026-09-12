/** Diagnostics intentionally exclude message, stack, query, body, headers and identity. */
export interface RouteDiagnostic {
  event: "admin_auth_failed" | "route_failed";
  method: string;
  path: string;
  status: number;
  errorClass: string;
  errorCode?: string;
  aborted: boolean;
}
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const CLASSES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError"]);
const CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "P1001", "P1002", "P2002", "P2024", "P2034"]);
export function routeDiagnostic(event: RouteDiagnostic["event"], request: Request, error: unknown): RouteDiagnostic {
  const value = error && typeof error === "object" ? error as { status?: unknown; name?: unknown; code?: unknown } : {};
  const status = typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599 ? value.status : 500;
  const pathname = new URL(request.url).pathname;
  // Dynamic path segments can contain identifiers or credentials too.
  const path = /^\/app(?:\/(?:billing|connector|conversations|settings))?(?:\.data)?$/.test(pathname) || pathname === "/auth/session-token" || pathname === "/auth/login" ? pathname : "/[other]";
  const errorClass = error instanceof Response ? "Response" : typeof value.name === "string" && CLASSES.has(value.name) ? value.name : "UnknownError";
  const errorCode = typeof value.code === "string" && CODES.has(value.code) ? value.code : undefined;
  return { event, method: METHODS.has(request.method) ? request.method : "OTHER", path, status, errorClass, ...(errorCode ? { errorCode } : {}), aborted: request.signal.aborted };
}
export function reportRouteFailure(event: RouteDiagnostic["event"], request: Request, error: unknown): void {
  try { console.error("[app-diagnostic]", JSON.stringify(routeDiagnostic(event, request, error))); } catch { /* Logging must never replace the original failure. */ }
}
export function observeAdminAuthentication<T>(
  admin: (request: Request) => Promise<T>,
  report: typeof reportRouteFailure = reportRouteFailure,
): (request: Request) => Promise<T> {
  return async request => {
    try { return await admin(request); }
    catch (error) {
      // Redirects, invalid-JWT retries and SDK document responses remain control flow.
      if (!(error instanceof Response) || error.status >= 500) {
        try { report("admin_auth_failed", request, error); } catch { /* Preserve SDK control flow even if the logger fails. */ }
      }
      throw error; // Exact identity, headers, body and status are preserved.
    }
  };
}
