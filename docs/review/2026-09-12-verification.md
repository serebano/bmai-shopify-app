# September 12 review verification

This is a verification record, not Shopify approval. Resubmission is pending.

## Deployed Shopify fixes

- 0.1.1: theme activation uses the app client ID; provisioning includes required connector metadata. PR #17.
- 0.1.2: publication includes the exact Shopify theme-editor ancestors; reusable Shopify specialist and reviewer instructions. PR #18.
- 0.1.3: Live/Connected requires an active tenant and matching published, desired and applied revisions from the official integration read. Reconnect reuses connector/provider IDs only within the same tenant. Unknown resolution usage is not displayed as zero. PR #20, deployed revision `20520363a97c9a5b0af2624afdef1e8f5320a82a`.
- 0.1.4: preserve runtime class names during client minification so Shopify's authentication boundary recognizes React Router recovery responses. PR #21.
- 0.1.5: internal navigation retains only verified shop, host and embedded routing context, removing authentication parameters. PR #22, deployed revision `c9f7c8ed03167cb2cc6cc70a318ffede21855d38`. CI passed 512 tests, typecheck, lint and production build.

## Observed live

- The corrected activation link opens the intended app embed; the existing development-store embed is enabled.
- Free → Growth → Scale → Free test contracts return to the app with the expected plan. Shopify explicitly identifies these development-store contracts as free to test. The final observed plan is Free / Active.
- Reconnect on 0.1.3 publishes refreshed knowledge without the earlier duplicate-connector warning.
- The official integration read works with the app's tenant-admin identity. The admin now displays Activating or Activation failed when projection has not completed; it no longer certifies that state as Live.
- On 0.1.5, fresh Shopify app entry followed by Store connection navigation produced `/app/connector` with only `shop`, `host` and `embedded` query keys. Reloading that route restored the full Store connection page. The earlier branded HTTP-200 error and subsequent blank recovery page were absent. The separate activation failure remained visible as expected.

## Still blocking completion

- Runtime projection: an old tenant removed from the authoritative system still owns the store slug in the serving database. The latest publication is rejected by the slug uniqueness constraint, so the older frame policy remains served. A tested reconciliation repair preserves old data and releases routing only after verifying authoritative ownership. Its platform release is not yet deployed.
- Metering: the current usage API has no AI-resolution ledger or cursor. A customer-confirmed versus assistant-declared resolution definition is still needed before implementing and verifying charges and the Free allowance. Do not substitute messages, model steps, human handoff closures or fabricated zero usage.

## Review access

No separate Busymate account is needed; Shopify authenticates the embedded app. The prepared instructions in `testing-instructions.md` explain review-store setup, theme activation and test billing. They have not yet been saved to the review form. Keep credentials and identifiable customer evidence out of this public repository.
