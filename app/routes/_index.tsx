import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { login } from "../shopify.server";
import { getStoreListing, storePageUrl } from "../lib/storeListing.server";

// Public entry: if a ?shop= is present, kick off managed install; else a splash.
// The splash's CONTENT (name, tagline, privacy link) renders from the canonical
// store record — the single source of truth shared with busymate.ai/store — so
// editing the record updates this page automatically (see storeListing.server).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  const listing = await getStoreListing();
  // Derived server-side so the component never touches the .server module
  // (React Router strips server code from the loader only).
  return { showForm: Boolean(login), listing, installUrl: storePageUrl(listing) };
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: `${data?.listing.name ?? "Busymate AI"} for Shopify` },
  {
    name: "description",
    content:
      data?.listing.tagline ?? "Grounded, order-aware AI support for your store",
  },
];

const DOCS_URL = "https://busymate.ai/docs";

// Minimal branded splash — theme-aware (system light/dark), self-contained,
// no external assets. Tokens mirror the busymate.ai store page palette.
const styles = `
  :root {
    --bm-bg: #ffffff;
    --bm-fg: #0a0a0a;
    --bm-fg-muted: #737373;
    --bm-border: #e5e5e5;
    --bm-accent: #3ecf8e;
    --bm-accent-hover: #34c584;
    --bm-accent-fg: #0b0e12;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bm-bg: #0a0a0a;
      --bm-fg: #fafafa;
      --bm-fg-muted: #a3a3a3;
      --bm-border: rgba(255, 255, 255, 0.1);
    }
  }
  body { margin: 0; background: var(--bm-bg); }
  .bm-landing {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    box-sizing: border-box;
    background: var(--bm-bg);
    color: var(--bm-fg);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    text-align: center;
  }
  .bm-card { max-width: 26rem; display: flex; flex-direction: column; align-items: center; gap: 1rem; }
  .bm-wordmark { display: flex; align-items: center; gap: 0.625rem; }
  .bm-wordmark svg { display: block; }
  .bm-wordmark-name { font-size: 1.375rem; font-weight: 600; letter-spacing: -0.02em; }
  .bm-wordmark-for {
    font-size: 0.8125rem; font-weight: 500; color: var(--bm-fg-muted);
    border: 1px solid var(--bm-border); border-radius: 999px; padding: 0.125rem 0.5rem;
  }
  .bm-tagline { margin: 0; font-size: 0.9375rem; line-height: 1.5; color: var(--bm-fg-muted); }
  .bm-install {
    display: inline-block; margin-top: 0.25rem; padding: 0.625rem 1.25rem;
    background: var(--bm-accent); color: var(--bm-accent-fg);
    font-size: 0.9375rem; font-weight: 600; text-decoration: none;
    border-radius: 0.5rem; transition: background 0.15s ease;
  }
  .bm-install:hover { background: var(--bm-accent-hover); }
  .bm-install:focus-visible, .bm-links a:focus-visible {
    outline: 2px solid var(--bm-accent); outline-offset: 2px; border-radius: 0.25rem;
  }
  .bm-coming { margin: 0; font-size: 0.8125rem; color: var(--bm-fg-muted); }
  .bm-links {
    display: flex; gap: 0.375rem; align-items: center;
    margin-top: 0.75rem; padding-top: 1rem; border-top: 1px solid var(--bm-border);
    font-size: 0.8125rem;
  }
  .bm-links a { color: var(--bm-fg-muted); text-decoration: none; }
  .bm-links a:hover { color: var(--bm-fg); text-decoration: underline; }
  .bm-links span { color: var(--bm-border); }
`;

// The listing icon's speech-bubble mark, inlined at wordmark size.
function BusymateMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 1200 1200" aria-hidden="true">
      <path
        d="M355 250h490a150 150 0 0 1 150 150v300a150 150 0 0 1-150 150h-300l-165 150v-150h-25a150 150 0 0 1-150-150v-300a150 150 0 0 1 150-150z"
        fill="#3ecf8e"
      />
      <circle cx="470" cy="550" r="46" fill="#0b0e12" />
      <circle cx="600" cy="550" r="46" fill="#0b0e12" />
      <circle cx="730" cy="550" r="46" fill="#0b0e12" />
    </svg>
  );
}

export default function LandingPage() {
  const { listing, installUrl } = useLoaderData<typeof loader>();
  return (
    <main className="bm-landing">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="bm-card">
        <div className="bm-wordmark">
          <BusymateMark />
          <span className="bm-wordmark-name">{listing.name}</span>
          <span className="bm-wordmark-for">for Shopify</span>
        </div>
        <p className="bm-tagline">{listing.tagline}</p>
        <a className="bm-install" href={installUrl}>
          Get {listing.name}
        </a>
        <p className="bm-coming">Coming to the Shopify App Store</p>
        <nav className="bm-links" aria-label="Footer">
          <a href={DOCS_URL}>Docs</a>
          {listing.privacy_url ? (
            <>
              <span aria-hidden="true">·</span>
              <a href={listing.privacy_url}>Privacy</a>
            </>
          ) : null}
        </nav>
      </div>
    </main>
  );
}
