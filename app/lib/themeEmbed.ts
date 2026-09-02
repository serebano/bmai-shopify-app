/**
 * Theme app-embed onboarding (App Store Req 5.1.3) — the ONE thing a merchant
 * must do after install: enable the "Busymate AI assistant" app embed in
 * Theme editor → App embeds. This module owns the deep link + the setup
 * checklist Home renders, and a scope-free embed detector.
 *
 * THE UUID: `activateAppId` takes the extension UUID SHOPIFY ASSIGNED to the
 * deployed theme extension — the segment in the CDN asset path the storefront
 * loads (`https://cdn.shopify.com/extensions/<uuid>/<version>/assets/assistant.js`).
 * It is NOT the `uid` in shopify.extension.toml. Pinned here + in
 * test/themeEmbed.test.ts; overridable via STOREFRONT_ASSISTANT_EXTENSION_UUID
 * should the extension ever be re-created.
 *
 * LEAST PRIVILEGE: no `read_themes` scope. Embed status is detected from the
 * PUBLIC storefront HTML (does it load the extension asset?). A password-
 * protected dev store or any non-200 is "unknown" — never a false "off".
 */
export const STOREFRONT_ASSISTANT_EXTENSION_UUID = "01a04ae4-bf97-7e8d-b8a4-a9c4cd3b4854";
/** blocks/assistant.liquid → the block handle in `activateAppId=<uuid>/<block>`. */
export const STOREFRONT_ASSISTANT_BLOCK = "assistant";
/** The app embed's name as listed in Theme editor → App embeds (schema `name`). */
export const APP_EMBED_LABEL = "Busymate AI assistant";

export function extensionUuid(env: NodeJS.ProcessEnv = process.env): string {
  return (env.STOREFRONT_ASSISTANT_EXTENSION_UUID ?? "").trim() || STOREFRONT_ASSISTANT_EXTENSION_UUID;
}

/** Theme editor with the app embed pre-activated (merchant still clicks Save). */
export function themeEditorActivateUrl(shop: string, opts: { uuid?: string; block?: string } = {}): string {
  const uuid = opts.uuid ?? extensionUuid();
  const block = opts.block ?? STOREFRONT_ASSISTANT_BLOCK;
  return `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${uuid}/${block}`;
}

/** Theme editor → App embeds panel (fallback when the deep link is stale). */
export function themeEditorAppEmbedsUrl(shop: string): string {
  return `https://${shop}/admin/themes/current/editor?context=apps`;
}

export type EmbedStatus = "on" | "off" | "unknown";

/**
 * Read the storefront home page and look for the extension asset. Uses no
 * Admin scope. `unknown` when the store is password-protected, errors, or is
 * not 200 — the UI then shows the written steps instead of a false "off".
 */
export async function detectStorefrontEmbed(
  shop: string,
  doFetch: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  uuid: string = extensionUuid(),
): Promise<EmbedStatus> {
  try {
    const res = await doFetch(`https://${shop}/`, {
      redirect: "follow",
      headers: { accept: "text/html", "user-agent": "BusymateAI-Shopify-App/1.0 (+https://store.busymate.ai)" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 200) return "unknown";
    const html = await res.text();
    if (/action="\/password"|\/password\b/.test(html) && !html.includes("cdn.shopify.com/extensions/")) return "unknown";
    return html.includes(`cdn.shopify.com/extensions/${uuid}/`) ? "on" : "off";
  } catch {
    return "unknown";
  }
}

// ---- Home setup checklist ---------------------------------------------------

export type SetupStepId = "provisioned" | "embed" | "trained" | "plan";

export interface SetupStep {
  id: SetupStepId;
  title: string;
  detail: string;
  done: boolean;
  failed: boolean;
}

export interface TrainingCounts {
  products: number | null;
  policies: number | null;
  pages: number | null;
}

export interface SetupInput {
  provisionState: string;
  connectorReady: boolean;
  embed: EmbedStatus;
  trainedAt: string | null;
  trainError: string | null;
  /** Items the assistant was trained on (ShopTenant.kb*); null = unknown/never. */
  counts?: TrainingCounts | null;
  /** Items the store has — "N of M" when the catalog was truncated to fit. */
  fetched?: Partial<TrainingCounts> | null;
  truncated?: boolean | null;
  planId: string | null;
  hasSubscription: boolean;
}

/** "62 of 250 products, 3 policies, 4 pages" — the honest training summary. */
export function trainingSummary(counts: TrainingCounts | null | undefined, fetched?: Partial<TrainingCounts> | null): string | null {
  if (!counts || counts.products === null) return null;
  const part = (n: number | null, total: number | null | undefined, noun: string) => {
    const count = n ?? 0;
    const shown = typeof total === "number" && total > count ? `${count} of ${total}` : `${count}`;
    return `${shown} ${noun}`;
  };
  return `${part(counts.products, fetched?.products, "products")}, ${part(counts.policies, fetched?.policies, "policies")}, ${part(counts.pages, fetched?.pages, "pages")}`;
}

/** Human date for "last trained" (ISO → e.g. "2 Sep 2026, 10:00"). */
export function formatTrainedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

/** Written steps rendered next to the primary "Turn on" button. */
export const EMBED_STEPS: readonly string[] = [
  "Open your theme editor (Online Store → Themes → Customize).",
  "Open the App embeds panel (the puzzle-piece icon on the left).",
  `Switch on "${APP_EMBED_LABEL}".`,
  "Click Save. The \"Ask us\" launcher appears on every storefront page.",
];

export function buildSetupChecklist(s: SetupInput): SetupStep[] {
  const provisioned = s.provisionState === "published";
  const provisionFailed = s.provisionState === "error";
  const trained = Boolean(s.trainedAt) && !s.trainError;
  const paid = s.hasSubscription && s.planId && s.planId !== "free";
  return [
    {
      id: "provisioned",
      title: "Assistant provisioned",
      detail: provisionFailed
        ? "Provisioning hit an error — retry below."
        : provisioned
          ? s.connectorReady
            ? "Your assistant is live and connected to your store's orders."
            : "Your assistant is live. The order connector is still registering."
          : s.provisionState === "suspended"
            ? "The assistant is suspended (the app was uninstalled). Reinstall or retry to restore it."
            : "Setting up your assistant…",
      done: provisioned,
      failed: provisionFailed,
    },
    {
      id: "embed",
      title: "Storefront assistant switched on",
      detail:
        s.embed === "on"
          ? "The \"Ask us\" launcher is live on your storefront."
          : s.embed === "off"
            ? "Not on yet — the launcher is not loading on your storefront."
            : "Enable the app embed in your theme editor (we can't confirm it on a password-protected store).",
      done: s.embed === "on",
      failed: false,
    },
    {
      id: "trained",
      title: "Trained on your store",
      detail: s.trainError
        ? `Training failed: ${s.trainError} — fix the cause, then re-train from Store connection.`
        : trained
          ? `Trained on ${trainingSummary(s.counts, s.fetched) ?? "your products, policies and pages"} · last trained ${formatTrainedAt(s.trainedAt!)} · product changes re-train automatically; re-train from Store connection after policy or page changes.`
          : "Not trained yet — the assistant answers from your products, pages and policies once training completes.",
      done: trained,
      failed: Boolean(s.trainError),
    },
    {
      id: "plan",
      title: "Plan",
      detail: paid
        ? `You're on the ${s.planId!.charAt(0).toUpperCase() + s.planId!.slice(1)} plan.`
        : "You're on the Free plan — 25 resolutions a month, then conversations route to your team. Change plan any time.",
      done: true,
      failed: false,
    },
  ];
}
