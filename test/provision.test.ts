import { describe, expect, it, vi } from "vitest";
import {
  runProvisionLifecycle,
  provisionOnInstall,
  CONNECTOR_POLICIES,
  servingHost,
  type ProvisionDeps,
  type TenantPatch,
} from "../app/lib/provision";
import type { PartnerProof } from "../app/lib/partnerProof";

// The tenant-provisioning SEAM — exercised with the Shopify session + bmai MCP
// calls fully mocked (no Partner app, no real shop, no control plane). Asserts the
// proof-of-shop lifecycle order, proof threading, best-effort vs load-bearing
// steps, fail-closed behaviour, and the final persisted state.

const STUB_PROOF: PartnerProof = { partner: "shopify", shop: "acme.myshopify.com", proof: "deadbeef", ts: 1787900000000 };

function makeDeps(
  call: ProvisionDeps["call"],
  opts: { proof?: PartnerProof | null; delegationReady?: boolean } = {},
): { deps: ProvisionDeps; states: TenantPatch[] } {
  const states: TenantPatch[] = [];
  const deps: ProvisionDeps = {
    call,
    getTenant: async () => ({ bmaiTenantId: null, customDomain: null }),
    saveTenant: async (_shop, patch) => {
      states.push(patch);
    },
    connectorEndpoint: () => "https://shopify.busymate.ai/mcp",
    embedOrigin: "https://busymate.ai",
    signProof: () => (opts.proof === undefined ? STUB_PROOF : opts.proof),
    delegationReady: opts.delegationReady ?? false,
  };
  return { deps, states };
}

const session = { shop: "acme.myshopify.com", email: "owner@acme.com", accessToken: "off_tok" };

describe("tenant provisioning lifecycle (seam)", () => {
  it("runs the full lifecycle in order and publishes on success", async () => {
    const call = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
      if (name === "provision_partner_tenant") return { ok: true, data: { tenant_id: "t_123" } };
      if (name === "upsert_tenant_support_connector") return { ok: true, data: { id: "c_9" } };
      return { ok: true };
    });
    const { deps, states } = makeDeps(call as unknown as ProvisionDeps["call"]);

    const out = await runProvisionLifecycle(session, deps);

    expect(out.ok).toBe(true);
    expect(out.tenantId).toBe("t_123");
    expect(out.connectorId).toBe("c_9");
    // Exact ordered contract with the bmai MCP tenant tools (NO operator-only
    // set_tenant_domain — the tenant serves at the derived <slug>.busymate.ai lane).
    expect(out.calls).toEqual([
      "provision_partner_tenant",
      "set_tenant_branding",
      "add_tenant_embed_origin",
      "upsert_tenant_support_connector",
      "publish_tenant_runtime",
    ]);
    // add_tenant_admin is NOT called (needs a bmai user_id a Shopify install lacks).
    expect(out.calls).not.toContain("add_tenant_admin");
    expect(out.warnings).toEqual([]);
    // Final persisted state is "published".
    expect(states.at(-1)?.provisionState).toBe("published");
    expect(states.at(-1)?.bmaiTenantId).toBe("t_123");
  });

  it("threads the proof-of-shop into provision + embed-origin, and never sends set_tenant_domain", async () => {
    const seen: Record<string, Record<string, unknown>> = {};
    const call = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      seen[name] = args ?? {};
      if (name === "provision_partner_tenant") return { ok: true, data: { tenant_id: "t_1" } };
      return { ok: true };
    });
    const { deps } = makeDeps(call as unknown as ProvisionDeps["call"]);
    const out = await runProvisionLifecycle(session, deps);

    expect(out.calls).not.toContain("set_tenant_domain");
    // provision carries partner/shop/proof/ts + slug
    expect(seen["provision_partner_tenant"]).toMatchObject({ partner: "shopify", shop: session.shop, proof: "deadbeef", ts: STUB_PROOF.ts });
    expect(seen["provision_partner_tenant"].slug).toMatch(/^shop-/);
    // embed-origin uses the PROOF path (no tenant_id needed) + the storefront origin + confirm
    expect(seen["add_tenant_embed_origin"]).toMatchObject({ proof: "deadbeef", confirm: true });
    expect(seen["add_tenant_embed_origin"].origins).toContain(`https://${session.shop}`);
    // publish sends the derived serving host as a launch origin + confirm
    expect(seen["publish_tenant_runtime"]).toMatchObject({ tenant_id: "t_1", confirm: true });
    expect(seen["publish_tenant_runtime"].launch_origins).toContain(servingHost("shop-acme"));
    // #1982 security follow-up #5 — LEAST PRIVILEGE: every tenant-management call
    // carries proof-of-shop so it authorizes via the proof arm, NOT the platform-
    // operator role (which the provisioner no longer needs / holds).
    for (const mgmt of ["set_tenant_branding", "upsert_tenant_support_connector", "publish_tenant_runtime"]) {
      expect(seen[mgmt]).toMatchObject({ partner: "shopify", shop: session.shop, proof: "deadbeef", ts: STUB_PROOF.ts });
    }
  });

  it("registers the connector read-only (public + identified; delegated writes deferred)", async () => {
    const call = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
      if (name === "provision_partner_tenant") return { ok: true, data: { tenant_id: "t_1" } };
      return { ok: true };
    });
    const { deps } = makeDeps(call as unknown as ProvisionDeps["call"]);
    await runProvisionLifecycle(session, deps);

    const connectorCall = call.mock.calls.find((c) => c[0] === "upsert_tenant_support_connector");
    expect(connectorCall).toBeDefined();
    const args = connectorCall![1] as unknown as {
      auth_mode: string;
      delegation_mode: string;
      tool_access: Record<string, string>;
    };
    // Unauthenticated server access; no delegation until the actor verifier ships.
    expect(args.auth_mode).toBe("none");
    expect(args.delegation_mode).toBe("none");
    // Read tiers registered: public reads + identified customer reads.
    expect(args.tool_access.search_products).toBe("public");
    expect(args.tool_access.get_order_status).toBe("identified");
    // Delegated WRITE tools are NOT registered yet (would be refused w/o verifier).
    expect(args.tool_access.create_refund).toBeUndefined();
    expect(args.tool_access.start_return).toBeUndefined();
  });

  it("flips to signed_actor_token + registers the delegated writes when the verifier is ready", async () => {
    const call = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
      if (name === "provision_partner_tenant") return { ok: true, data: { tenant_id: "t_1" } };
      return { ok: true };
    });
    const { deps } = makeDeps(call as unknown as ProvisionDeps["call"], { delegationReady: true });
    await runProvisionLifecycle(session, deps);

    const connectorCall = call.mock.calls.find((c) => c[0] === "upsert_tenant_support_connector");
    const args = connectorCall![1] as unknown as {
      auth_mode: string;
      delegation_mode: string;
      tool_access: Record<string, string>;
    };
    // Actor verifier ready → per-user delegation via the signed actor token.
    expect(args.auth_mode).toBe("none");
    expect(args.delegation_mode).toBe("signed_actor_token");
    // Read tiers still present…
    expect(args.tool_access.search_products).toBe("public");
    expect(args.tool_access.get_order_status).toBe("identified");
    // …and EVERY delegated write tool is now registered as delegated.
    for (const t of CONNECTOR_POLICIES.delegated_tools) {
      expect(args.tool_access[t]).toBe("delegated");
    }
  });

  it("never calls add_tenant_admin (a Shopify install has no bmai user_id)", async () => {
    const call = vi.fn(async (name: string) =>
      name === "provision_partner_tenant" ? { ok: true, data: { tenant_id: "t_1" } } : { ok: true },
    );
    const { deps } = makeDeps(call as unknown as ProvisionDeps["call"]);
    const out = await runProvisionLifecycle({ shop: "x.myshopify.com", email: "m@x.com" }, deps);
    expect(out.calls).not.toContain("add_tenant_admin");
  });

  it("BEST-EFFORT: a denied set_tenant_branding warns but still publishes", async () => {
    const call = vi.fn(async (name: string) => {
      if (name === "provision_partner_tenant") return { ok: true, data: { tenant_id: "t_1" } };
      if (name === "set_tenant_branding") return { ok: false, error: "tenant-admin required" };
      return { ok: true };
    });
    const { deps, states } = makeDeps(call as unknown as ProvisionDeps["call"]);
    const out = await runProvisionLifecycle(session, deps);

    expect(out.ok).toBe(true); // publish still happened
    expect(out.warnings.some((w) => w.startsWith("set_tenant_branding:"))).toBe(true);
    expect(states.at(-1)?.provisionState).toBe("published");
  });

  it("FAILS CLOSED: a failed provision records error state and never publishes", async () => {
    const call = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
      if (name === "provision_partner_tenant") return { ok: false, error: "provision_partner_tenant denied" };
      return { ok: true };
    });
    const { deps, states } = makeDeps(call as unknown as ProvisionDeps["call"]);

    const out = await runProvisionLifecycle(session, deps);

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/denied/);
    // No branding, nothing after the failed provision.
    expect(out.calls).toEqual(["provision_partner_tenant"]);
    expect(states.at(-1)?.provisionState).toBe("error");
  });

  it("FAILS CLOSED: a failed publish records error state (tenant created, not live)", async () => {
    const call = vi.fn(async (name: string) => {
      if (name === "provision_partner_tenant") return { ok: true, data: { tenant_id: "t_1" } };
      if (name === "publish_tenant_runtime") return { ok: false, error: "preflight unmet" };
      return { ok: true };
    });
    const { deps, states } = makeDeps(call as unknown as ProvisionDeps["call"]);
    const out = await runProvisionLifecycle(session, deps);

    expect(out.ok).toBe(false);
    expect(out.tenantId).toBe("t_1"); // created…
    expect(states.at(-1)?.provisionState).toBe("error"); // …but not live
    expect(states.at(-1)?.provisionError).toMatch(/publish_tenant_runtime/);
  });

  // --- provisionOnInstall: the afterAuth guard that must NEVER throw ---
  // (App Store review 2.1.1/2.1.3: an afterAuth throw becomes a bare embedded-app
  // 500. runProvisionLifecycle records error state for a failed MCP step but still
  // THROWS at its Prisma write boundary — the guard is what makes afterAuth safe.)

  it("provisionOnInstall NEVER throws — a Prisma write race records error state instead of a 500", async () => {
    // saveTenant throws on the FIRST write (the initial `provisioning` state), like
    // a P2002 unique-constraint race from Shopify's App-Bridge double install bounce.
    let writes = 0;
    const states: TenantPatch[] = [];
    const call = vi.fn(async () => ({ ok: true }));
    const deps: ProvisionDeps = {
      call: call as unknown as ProvisionDeps["call"],
      getTenant: async () => null,
      saveTenant: async (_shop, patch) => {
        writes += 1;
        if (writes === 1) throw new Error("Unique constraint failed on the fields: (`shop`)");
        states.push(patch);
      },
      connectorEndpoint: () => "https://store.busymate.ai/mcp",
      embedOrigin: "https://busymate.ai",
      signProof: () => STUB_PROOF,
      delegationReady: false,
    };

    // Must RESOLVE (never reject) — that is the whole contract afterAuth relies on.
    await expect(provisionOnInstall(session, deps)).resolves.toMatchObject({ ok: false });
    // The failure is recorded as an operational error state (surfaced in the app UI).
    expect(states.at(-1)?.provisionState).toBe("error");
    expect(states.at(-1)?.provisionError).toMatch(/Unique constraint/);
  });

  it("provisionOnInstall swallows a TOTAL DB outage (even the error-record write throws)", async () => {
    const deps: ProvisionDeps = {
      call: (async () => ({ ok: true })) as unknown as ProvisionDeps["call"],
      getTenant: async () => {
        throw new Error("DB down");
      },
      saveTenant: async () => {
        throw new Error("DB down");
      },
      connectorEndpoint: () => "https://store.busymate.ai/mcp",
      embedOrigin: "https://busymate.ai",
      signProof: () => STUB_PROOF,
      delegationReady: false,
    };
    // Nothing can be persisted, yet the guard must still resolve — afterAuth cannot
    // be allowed to 500 the embedded app even when the DB is entirely unreachable.
    await expect(provisionOnInstall(session, deps)).resolves.toMatchObject({ ok: false });
  });

  it("provisionOnInstall does NOT stomp a racing success — a concurrent publish wins", async () => {
    // The initial write throws (lost the race), but by the time we re-read, the
    // racing install has already provisioned the tenant → keep the good state.
    const call = vi.fn(async () => ({ ok: true }));
    const deps: ProvisionDeps = {
      call: call as unknown as ProvisionDeps["call"],
      getTenant: async () => ({ bmaiTenantId: "t_win", customDomain: null }),
      saveTenant: async () => {
        throw new Error("Unique constraint failed on the fields: (`shop`)");
      },
      connectorEndpoint: () => "https://store.busymate.ai/mcp",
      embedOrigin: "https://busymate.ai",
      signProof: () => STUB_PROOF,
      delegationReady: false,
    };
    const out = await provisionOnInstall(session, deps);
    expect(out.ok).toBe(true);
    expect(out.tenantId).toBe("t_win");
  });

  it("provisionOnInstall passes a normal successful lifecycle straight through", async () => {
    const call = vi.fn(async (name: string) =>
      name === "provision_partner_tenant" ? { ok: true, data: { tenant_id: "t_ok" } } : { ok: true },
    );
    const { deps, states } = makeDeps(call as unknown as ProvisionDeps["call"]);
    const out = await provisionOnInstall(session, deps);
    expect(out.ok).toBe(true);
    expect(out.tenantId).toBe("t_ok");
    expect(states.at(-1)?.provisionState).toBe("published");
  });

  it("still provisions with NO proof (operator path) — proofArgs are simply omitted", async () => {
    const seen: Record<string, Record<string, unknown>> = {};
    const call = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      seen[name] = args ?? {};
      if (name === "provision_partner_tenant") return { ok: true, data: { tenant_id: "t_1" } };
      return { ok: true };
    });
    const { deps } = makeDeps(call as unknown as ProvisionDeps["call"], { proof: null });
    const out = await runProvisionLifecycle(session, deps);
    expect(out.ok).toBe(true);
    expect(seen["provision_partner_tenant"].proof).toBeUndefined();
    expect(seen["provision_partner_tenant"]).toMatchObject({ partner: "shopify", shop: session.shop });
  });
});
