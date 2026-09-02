import { isRouteErrorResponse } from "react-router";

/** What the branded error page shows — never the underlying error or a stack. */
export interface RouteErrorView {
  status: number;
  title: string;
  message: string;
}

const GENERIC = "Something went wrong";
const MERCHANT_HINT = "If you are a merchant, open Busymate AI from the Apps section of your Shopify admin.";

/**
 * Map a React Router route error to the copy the public host renders. Pure: the
 * root ErrorBoundary calls it with useRouteError(). Unknown routes (/favicon.ico
 * probes, scanners, typos) are a 404; a thrown Error is a 500 whose message and
 * stack stay in the server log — the page never carries developer hints.
 */
export function describeRouteError(error: unknown): RouteErrorView {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        status: 404,
        title: "Page not found",
        message: `The page you are looking for does not exist. ${MERCHANT_HINT}`,
      };
    }
    return {
      status: error.status,
      title: GENERIC,
      message: `This request could not be completed. ${MERCHANT_HINT}`,
    };
  }
  return {
    status: 500,
    title: GENERIC,
    message: `An unexpected error occurred and has been logged. Please try again. ${MERCHANT_HINT}`,
  };
}
