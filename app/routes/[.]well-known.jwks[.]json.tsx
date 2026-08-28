import { publicJwks } from "../lib/identity";

// JWKS for identified launch — the tenant's visitor identity provider registers
// this URL (set_tenant_visitor_identity_provider). Public keys only.
export const loader = async () => {
  const jwks = await publicJwks();
  return Response.json(jwks, {
    headers: { "cache-control": "public, max-age=300" },
  });
};
