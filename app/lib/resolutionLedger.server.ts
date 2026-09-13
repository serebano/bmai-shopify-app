/**
 * The AI-resolution PRODUCER (#19 / devtools #2835) — the piece review found
 * missing: `usageBilling.ts` used to read `get_tenant_usage`, which returns
 * tenant entity counts, not a resolutions/cursor pair, so usage stayed
 * unreadable. This module derives real billable-resolution counts from the
 * platform's own conversation + hand-off events (the same
 * `list_tenant_conversations` / `list_tenant_interventions` MCP tools already
 * proven live by the Conversations page, app/lib/tenantRead.server.ts) and
 * applies `decideResolutions` (app/lib/resolutionDefinition.ts).
 *
 * RETRY-SAFE BATCH IDENTITY: `readNewResolutions` does NOT write to the ledger.
 * It returns a candidate batch whose `cursor` is a content hash of the billable
 * session ids (`evidenceRefFor`) — stable across retries of the SAME undecided
 * batch, unlike a wall-clock timestamp. `usageBilling.meterShop` only calls
 * `commitCountedResolutions` (via `saveCursor`, see usageBilling.ts) once a
 * batch is DONE (reported, or determined not to need reporting) — a batch held
 * by a transient failure is simply re-derived next run with, in the common
 * case, the identical cursor/idempotency key, matching the delivery outbox's
 * own stable-payload-hash contract (app/lib/meterOutbox.ts).
 *
 * IDEMPOTENT PER CONVERSATION ID: once committed, `MeteredResolution` is a
 * `@@unique([tenantId, sessionId])` ledger — a session is counted AT MOST ONCE
 * per tenant, ever, no matter how many times `list_tenant_conversations`
 * (a rolling recent window) re-surfaces it.
 *
 * FAIL CLOSED (never fabricate): an unreadable conversations OR handoffs read
 * returns null — the caller (usageBilling.meterShop) already treats that as
 * "resolutions unreadable" and holds the cursor, never guesses zero.
 */
import { createHash } from "node:crypto";
import prisma from "../db.server";
import { callMcpTool } from "../bmai.server";
import { listTenantConversations, listTenantInterventionsAll, type ConversationRow, type HandoffRow, type McpCall } from "./tenantRead.server";
import { decideResolutions } from "./resolutionDefinition";

export interface CountedSession {
  sessionId: string;
  occurredAt: string;
}

export interface ResolutionBatch {
  /** Candidate billable resolutions in THIS batch — NOT yet persisted. */
  resolutions: number;
  /** A content hash of `sessions` (stable across retries of the identical batch), or the prior cursor's successor sentinel when empty. */
  cursor: string;
  occurredFrom: string | null;
  occurredThrough: string | null;
  /** Same as `cursor` — named for outbox evidence-reference readability. */
  evidenceRef: string | null;
  /** The exact sessions this batch would commit — consumed by `commitCountedResolutions`. */
  sessions: CountedSession[];
}

export interface ResolutionLedgerDeps {
  listConversations: (tenantId: string) => Promise<{ ok: boolean; rows: ConversationRow[]; error?: string }>;
  listHandoffs: (tenantId: string) => Promise<{ ok: boolean; rows: HandoffRow[]; error?: string }>;
  alreadyCounted: (tenantId: string, sessionIds: string[]) => Promise<Set<string>>;
  /**
   * Edge-triggered "this tenant is unreachable" bookkeeping. `unreachable`
   * reflects THIS run's read; returns whether that is a CHANGE from the
   * stored state (so the caller logs once per transition, not once per run).
   */
  markTenantReachability: (tenantId: string, unreachable: boolean) => Promise<{ changed: boolean }>;
  now?: () => Date;
}

/**
 * The platform's authorization-denial signal for a tenant this app's stored
 * provisioner identity is no longer admin-of — in practice, a deprovisioned or
 * archived tenant whose local `ShopTenant.bmaiTenantId` has drifted stale.
 * Distinct from a genuinely transient/unexpected error, which must still fail
 * closed (never silently treated as "nothing to meter").
 */
export function isTenantManagementDenied(error: string | undefined): boolean {
  return typeof error === "string" && error.includes("tenant_management_denied");
}

const EMPTY_BATCH: ResolutionBatch = { resolutions: 0, cursor: evidenceRefFor([]), occurredFrom: null, occurredThrough: null, evidenceRef: null, sessions: [] };

/** How many recent conversations to scan per tenant per run — generous over the hourly timer cadence. */
export const CONVERSATION_SCAN_LIMIT = 200;

/** Deterministic, order-independent identity for a set of session ids. */
export function evidenceRefFor(sessionIds: readonly string[]): string {
  const sorted = [...sessionIds].sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex");
}

/**
 * Pure-ish orchestration over injected deps (no ledger WRITE — see module doc).
 * Returns null (unreadable) rather than a fabricated zero when either MCP read
 * is refused.
 */
export async function readNewResolutions(tenantId: string, deps: ResolutionLedgerDeps): Promise<ResolutionBatch | null> {
  // SEQUENTIAL on purpose (never `Promise.all`): both reads share ONE rotating
  // refresh credential. The token provider now coalesces concurrent refreshes,
  // but this runs hourly for every active shop on a possibly cold cache, so the
  // belt-and-suspenders ordering stays — see docs/BILLING.md "Incident 2026-09-13".
  const conv = await deps.listConversations(tenantId);
  if (!conv.ok) return handleUnreadable(tenantId, conv.error, deps);
  const handoffs = await deps.listHandoffs(tenantId);
  if (!handoffs.ok) return handleUnreadable(tenantId, handoffs.error, deps);

  // Both reads succeeded: a tenant previously marked unreachable has recovered.
  const recovered = await deps.markTenantReachability(tenantId, false);
  if (recovered.changed) console.log(`[billing] tenant ${tenantId} resolution reads recovered — reachability restored`);

  const now = (deps.now ?? (() => new Date()))();
  const decisions = decideResolutions(conv.rows, handoffs.rows, now);
  const billable: CountedSession[] = decisions
    .filter((d): d is typeof d & { occurredAt: string } => d.billable && Boolean(d.occurredAt))
    .map((d) => ({ sessionId: d.sessionId, occurredAt: d.occurredAt }));
  if (billable.length === 0) return { resolutions: 0, cursor: evidenceRefFor([]), occurredFrom: null, occurredThrough: null, evidenceRef: null, sessions: [] };

  const already = await deps.alreadyCounted(tenantId, billable.map((b) => b.sessionId));
  const fresh = billable.filter((b) => !already.has(b.sessionId));
  if (fresh.length === 0) return { resolutions: 0, cursor: evidenceRefFor([]), occurredFrom: null, occurredThrough: null, evidenceRef: null, sessions: [] };

  const times = fresh.map((f) => Date.parse(f.occurredAt)).filter(Number.isFinite);
  const ref = evidenceRefFor(fresh.map((f) => f.sessionId));
  return {
    resolutions: fresh.length,
    cursor: ref,
    occurredFrom: new Date(Math.min(...times)).toISOString(),
    occurredThrough: new Date(Math.max(...times)).toISOString(),
    evidenceRef: ref,
    sessions: fresh,
  };
}

/**
 * A refused MCP read: `tenant_management_denied` is a QUIET SKIP (an expected,
 * stable condition for a deprovisioned tenant — a real zero, logged once per
 * transition, never per run); anything else FAILS CLOSED (null — "unreadable",
 * held, retried next run, never guessed as zero).
 */
async function handleUnreadable(tenantId: string, error: string | undefined, deps: ResolutionLedgerDeps): Promise<ResolutionBatch | null> {
  if (!isTenantManagementDenied(error)) return null;
  const marked = await deps.markTenantReachability(tenantId, true);
  if (marked.changed) console.warn(`[billing] tenant ${tenantId} resolution reads denied (tenant_management_denied) — treating as a quiet zero until it recovers`);
  return EMPTY_BATCH;
}

/**
 * Permanently commit a batch's sessions to the idempotent ledger — call ONLY
 * once the batch is DONE (reported to Shopify, or determined not to need
 * reporting). `skipDuplicates` makes this race-safe against overlapping runs;
 * returns how many rows were ACTUALLY newly committed.
 */
export async function commitCountedResolutions(tenantId: string, sessions: CountedSession[]): Promise<number> {
  if (sessions.length === 0) return 0;
  const { count } = await prisma.meteredResolution.createMany({
    data: sessions.map((s) => ({ tenantId, sessionId: s.sessionId, occurredAt: new Date(s.occurredAt) })),
    skipDuplicates: true,
  });
  return count;
}

/** Live production deps: the real MCP reads + the Prisma-backed "already counted" check. */
export function liveResolutionLedgerDeps(call: McpCall = callMcpTool): ResolutionLedgerDeps {
  return {
    listConversations: (tenantId) => listTenantConversations(tenantId, CONVERSATION_SCAN_LIMIT, call),
    listHandoffs: (tenantId) => listTenantInterventionsAll(tenantId, call),
    alreadyCounted: async (tenantId, sessionIds) => {
      if (sessionIds.length === 0) return new Set();
      const rows = await prisma.meteredResolution.findMany({ where: { tenantId, sessionId: { in: sessionIds } }, select: { sessionId: true } });
      return new Set(rows.map((r) => r.sessionId));
    },
    markTenantReachability: async (tenantId, unreachable) => {
      // `updateMany` (not `update`): bmaiTenantId is not a unique key on
      // ShopTenant, and this must never throw for a tenantId that matches zero
      // or more than one row — it is bookkeeping, not the source of truth.
      const row = await prisma.shopTenant.findFirst({ where: { bmaiTenantId: tenantId }, select: { shop: true, tenantUnreachableAt: true } });
      if (!row) return { changed: false }; // no local shop row for this tenant — nothing to flag
      const wasUnreachable = row.tenantUnreachableAt !== null;
      if (wasUnreachable === unreachable) return { changed: false };
      await prisma.shopTenant.update({ where: { shop: row.shop }, data: { tenantUnreachableAt: unreachable ? new Date() : null } });
      return { changed: true };
    },
  };
}
