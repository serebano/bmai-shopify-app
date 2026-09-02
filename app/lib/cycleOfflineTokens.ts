/**
 * One-off cycling of NON-expiring offline access tokens (#2110).
 *
 * Under `future.expiringOfflineAccessTokens` the library mints expiring tokens for
 * NEW installs and refreshes them, but it never replaces an EXISTING permanent
 * token on its own: a session whose `expires` is null is "active" forever, so it
 * is never re-exchanged — and Shopify now rejects it (403 "Non-expiring access
 * tokens are no longer accepted"). This pure core picks those sessions, exchanges
 * each through Shopify's migration grant (`api.auth.migrateToExpiringToken`),
 * stores the expiring result, and reports per shop. Value-blind: no token value
 * ever reaches the report or the log. Driven by scripts/cycle-offline-tokens.ts.
 */
export interface OfflineSessionLike {
  id: string;
  shop: string;
  accessToken?: string;
  expires?: Date;
  refreshToken?: string;
  refreshTokenExpires?: Date;
}

export interface CycleDeps {
  /** Every OFFLINE session, with credentials already decrypted. */
  listOfflineSessions(): Promise<OfflineSessionLike[]>;
  /** Exchange a permanent token for an expiring session (+ refresh token). */
  migrate(shop: string, nonExpiringOfflineAccessToken: string): Promise<OfflineSessionLike>;
  /** Persist the new session (through the encrypting storage). */
  store(session: OfflineSessionLike): Promise<boolean>;
  log?(line: string): void;
}

export interface CycleOptions {
  /** Restrict to one shop domain. */
  shop?: string;
  /** List candidates only; exchange nothing. */
  dryRun?: boolean;
}

export interface CycleReport {
  scanned: number;
  candidates: string[];
  cycled: string[];
  skipped: Array<{ shop: string; reason: string }>;
  failed: Array<{ shop: string; error: string }>;
}

/** An expiring session has BOTH an expiry and a refresh token. */
export function isExpiringSession(s: OfflineSessionLike): boolean {
  return s.expires instanceof Date && typeof s.refreshToken === "string" && s.refreshToken.length > 0;
}

function redact(text: string, secrets: Array<string | undefined>): string {
  return secrets.reduce<string>((t, s) => (s ? t.split(s).join("[redacted]") : t), text);
}

export async function cycleOfflineTokens(deps: CycleDeps, opts: CycleOptions = {}): Promise<CycleReport> {
  const log = deps.log ?? (() => {});
  const sessions = await deps.listOfflineSessions();
  const report: CycleReport = { scanned: sessions.length, candidates: [], cycled: [], skipped: [], failed: [] };

  for (const s of sessions) {
    if (opts.shop && s.shop !== opts.shop) {
      report.skipped.push({ shop: s.shop, reason: "not the requested shop" });
      continue;
    }
    if (isExpiringSession(s)) {
      report.skipped.push({ shop: s.shop, reason: "already expiring" });
      continue;
    }
    if (!s.accessToken) {
      report.skipped.push({ shop: s.shop, reason: "no access token stored" });
      continue;
    }
    report.candidates.push(s.shop);
    if (opts.dryRun) {
      log(`[cycle] candidate shop=${s.shop} (dry run)`);
      continue;
    }
    const secrets: Array<string | undefined> = [s.accessToken];
    try {
      const next = await deps.migrate(s.shop, s.accessToken);
      secrets.push(next.accessToken, next.refreshToken);
      if (!isExpiringSession(next)) {
        throw new Error("exchange returned a session that is not expiring (missing expiry or refresh token)");
      }
      if (!(await deps.store(next))) throw new Error("session store returned false");
      report.cycled.push(s.shop);
      log(
        `[cycle] cycled shop=${s.shop} expires=${next.expires!.toISOString()} refreshTokenExpires=${
          next.refreshTokenExpires?.toISOString() ?? "-"
        }`,
      );
    } catch (err) {
      const error = redact(err instanceof Error ? err.message : String(err), secrets);
      report.failed.push({ shop: s.shop, error });
      log(`[cycle] FAILED shop=${s.shop}: ${error}`);
    }
  }
  return report;
}
