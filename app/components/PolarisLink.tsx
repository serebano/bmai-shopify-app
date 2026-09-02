import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link as RouterLink } from "react-router";

/**
 * The Polaris `linkComponent` for the embedded admin (#2110).
 *
 * Polaris `<Link url>` / `<Button url>` render through this component. Internal
 * app paths go through React Router so navigation stays CLIENT-SIDE: the loader
 * runs as a data request that App Bridge signs with the session token, and the
 * iframe never reloads a bare URL. (A plain `<a href="/app/x">` reloads the admin
 * iframe WITHOUT host/shop/embedded/id_token — a document request the library
 * cannot authenticate, so the merchant lands on the error page.)
 *
 * Everything else stays a real anchor: absolute URLs (the Busymate AI console,
 * the serving host), `external`, or an explicit `target` — the theme-editor deep
 * link must navigate the TOP window (`_top`), never the iframe.
 */
export interface PolarisLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  url: string;
  external?: boolean;
  children?: ReactNode;
}

const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

export function isInternalAppPath(url: string, opts: { external?: boolean; target?: string } = {}): boolean {
  if (opts.external || opts.target) return false;
  return url.startsWith("/") && !ABSOLUTE.test(url);
}

export function PolarisLink({ url, external, target, rel, children, ...rest }: PolarisLinkProps) {
  if (isInternalAppPath(url, { external, target })) {
    return (
      <RouterLink to={url} {...rest}>
        {children}
      </RouterLink>
    );
  }
  const finalTarget = target ?? "_blank";
  const finalRel = rel ?? (finalTarget === "_blank" ? "noopener noreferrer" : undefined);
  return (
    <a href={url} target={finalTarget} rel={finalRel} {...rest}>
      {children}
    </a>
  );
}
