import { describe, expect, it, vi } from "vitest";
import { evidenceRefFor, readNewResolutions, type ResolutionLedgerDeps } from "../app/lib/resolutionLedger.server";
import type { ConversationRow, HandoffRow } from "../app/lib/tenantRead.server";

/**
 * The producer (#19/#2835): conversation + hand-off MCP reads → the
 * billable-resolution definition → idempotent-per-conversation-id counting.
 * `commitCountedResolutions` itself (the Prisma write) is exercised live by
 * `test/integration/meterOutbox.mjs`-style DB scenarios, not here — this file
 * proves the orchestration + retry-safe batch identity with injected deps.
 */
const NOW = new Date("2026-09-13T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

function conv(sessionId: string, lastActiveAt: string, live = false): ConversationRow {
  return { sessionId, supportSessionId: null, startedAt: null, lastActiveAt, live };
}

function deps(over: Partial<ResolutionLedgerDeps> & { alreadyCountedIds?: string[] } = {}): ResolutionLedgerDeps {
  const already = new Set(over.alreadyCountedIds ?? []);
  return {
    listConversations: over.listConversations ?? (async () => ({ ok: true, rows: [] })),
    listHandoffs: over.listHandoffs ?? (async () => ({ ok: true, rows: [] })),
    alreadyCounted: over.alreadyCounted ?? (async (_tenantId, ids) => new Set(ids.filter((id) => already.has(id)))),
    now: over.now ?? (() => NOW),
  };
}

describe("readNewResolutions", () => {
  it("counts a clean ended-no-handoff-stable conversation and returns its exact session for commit", async () => {
    const conversations: ConversationRow[] = [conv("s1", hoursAgo(30))];
    const out = await readNewResolutions("t_1", deps({ listConversations: async () => ({ ok: true, rows: conversations }) }));
    expect(out).toMatchObject({ resolutions: 1, occurredFrom: hoursAgo(30), occurredThrough: hoursAgo(30) });
    expect(out?.sessions).toEqual([{ sessionId: "s1", occurredAt: hoursAgo(30) }]);
    expect(out?.cursor).toBe(evidenceRefFor(["s1"]));
  });

  it("excludes handed-off and still-reopenable conversations from the count", async () => {
    const conversations: ConversationRow[] = [conv("billable", hoursAgo(30)), conv("handed-off", hoursAgo(30)), conv("too-recent", hoursAgo(1))];
    const handoffs: HandoffRow[] = [{ id: "i1", sessionId: "handed-off", status: "resolved", reason: null, requestedAt: null }];
    const out = await readNewResolutions(
      "t_1",
      deps({ listConversations: async () => ({ ok: true, rows: conversations }), listHandoffs: async () => ({ ok: true, rows: handoffs }) }),
    );
    expect(out?.resolutions).toBe(1);
    expect(out?.sessions.map((s) => s.sessionId)).toEqual(["billable"]);
  });

  it("idempotent per conversation id: a session already in the ledger is never recounted", async () => {
    const conversations: ConversationRow[] = [conv("s1", hoursAgo(30)), conv("s2", hoursAgo(30))];
    const out = await readNewResolutions(
      "t_1",
      deps({ listConversations: async () => ({ ok: true, rows: conversations }), alreadyCountedIds: ["s1"] }),
    );
    expect(out?.resolutions).toBe(1);
    expect(out?.sessions.map((s) => s.sessionId)).toEqual(["s2"]);
  });

  it("STABLE cursor across retries of the identical undecided batch (never a wall-clock value)", async () => {
    const conversations: ConversationRow[] = [conv("s1", hoursAgo(30))];
    const d = deps({ listConversations: async () => ({ ok: true, rows: conversations }) });
    const first = await readNewResolutions("t_1", d);
    const second = await readNewResolutions("t_1", d); // same deps, same "already counted" state (not yet committed)
    expect(first?.cursor).toBe(second?.cursor);
    expect(first?.cursor).toBe(evidenceRefFor(["s1"]));
  });

  it("fails closed (null) when either MCP read is refused — never a fabricated zero", async () => {
    expect(await readNewResolutions("t_1", deps({ listConversations: async () => ({ ok: false, rows: [] }) }))).toBeNull();
    expect(await readNewResolutions("t_1", deps({ listHandoffs: async () => ({ ok: false, rows: [] }) }))).toBeNull();
  });

  // Incident 2026-09-13: the two MCP reads share ONE rotating refresh credential;
  // issuing them concurrently on a cold cache raced the refresh grant and got the
  // token family revoked. They must be SEQUENTIAL — handoffs only after
  // conversations resolved, and never at all when conversations are unreadable.
  it("reads conversations then handoffs SEQUENTIALLY (never concurrently)", async () => {
    const order: string[] = [];
    let releaseConv!: () => void;
    const convGate = new Promise<void>((r) => { releaseConv = r; });
    const d = deps({
      listConversations: async () => { order.push("conv:start"); await convGate; order.push("conv:end"); return { ok: true, rows: [] }; },
      listHandoffs: async () => { order.push("handoffs:start"); return { ok: true, rows: [] }; },
    });
    const run = readNewResolutions("t_1", d);
    await Promise.resolve();
    expect(order).toEqual(["conv:start"]); // handoffs NOT started while conversations is in flight
    releaseConv();
    await run;
    expect(order).toEqual(["conv:start", "conv:end", "handoffs:start"]);
  });

  it("skips the handoffs read entirely when conversations are unreadable", async () => {
    const listHandoffs = vi.fn(async () => ({ ok: true, rows: [] as HandoffRow[] }));
    expect(await readNewResolutions("t_1", deps({ listConversations: async () => ({ ok: false, rows: [] }), listHandoffs }))).toBeNull();
    expect(listHandoffs).not.toHaveBeenCalled();
  });

  it("zero billable conversations ⇒ resolutions 0, no sessions to commit", async () => {
    const out = await readNewResolutions("t_1", deps());
    expect(out).toMatchObject({ resolutions: 0, sessions: [], occurredFrom: null, occurredThrough: null, evidenceRef: null });
  });

  it("occurredFrom/occurredThrough span the earliest/latest counted session", async () => {
    const conversations: ConversationRow[] = [conv("s1", hoursAgo(48)), conv("s2", hoursAgo(30))];
    const out = await readNewResolutions("t_1", deps({ listConversations: async () => ({ ok: true, rows: conversations }) }));
    expect(out).toMatchObject({ resolutions: 2, occurredFrom: hoursAgo(48), occurredThrough: hoursAgo(30) });
  });
});

describe("evidenceRefFor", () => {
  it("is order-independent (a stable set identity)", () => {
    expect(evidenceRefFor(["b", "a"])).toBe(evidenceRefFor(["a", "b"]));
  });
  it("differs for a different set", () => {
    expect(evidenceRefFor(["a"])).not.toBe(evidenceRefFor(["a", "b"]));
  });
});
