import { describe, expect, it } from "vitest";
import {
  BUSYMATE_AI_MCP_URL,
  resolveBusymateAiMcpUrl,
} from "../app/lib/bmaiSurface";

describe("Busymate AI MCP product boundary", () => {
  it("routes every tenant lifecycle call to the standalone Busymate AI MCP", () => {
    expect(resolveBusymateAiMcpUrl()).toBe(BUSYMATE_AI_MCP_URL);
    expect(resolveBusymateAiMcpUrl("https://busymate.ai/mcp/")).toBe(
      BUSYMATE_AI_MCP_URL,
    );
  });

  it("fails closed on the old Busymate DevTools MCP URL", () => {
    expect(() =>
      resolveBusymateAiMcpUrl("https://mcp.busymate.dev")
    ).toThrow(/separate product/i);
  });

  it("fails closed on any non-canonical MCP resource", () => {
    expect(() => resolveBusymateAiMcpUrl("https://example.com/mcp")).toThrow(
      /must be https:\/\/busymate\.ai\/mcp/,
    );
  });
});
