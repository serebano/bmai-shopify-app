import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { login } from "../shopify.server";

// Public entry: if a ?shop= is present, kick off managed install; else a splash.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

export default function LandingPage() {
  return (
    <main style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: 560, margin: "10vh auto", padding: "0 24px" }}>
      <h1>Busymate AI for Shopify</h1>
      <p>
        The Shopify AI agent that actually resolves — real order actions, answers
        only from your own policies with citations, 14 languages, honest
        pay-per-resolution pricing.
      </p>
      <p>Install this app from the Shopify App Store to add it to your store.</p>
    </main>
  );
}
