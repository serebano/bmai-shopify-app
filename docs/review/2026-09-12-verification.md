# September 12 review verification

This is a verification record, not Shopify approval. Resubmission is pending.

## Deployed Shopify fixes

- 0.1.1: theme activation uses the app client ID; provisioning includes required connector metadata. PR #17.
- 0.1.2: publication includes the exact Shopify theme-editor ancestors; reusable Shopify specialist and reviewer instructions. PR #18.
- 0.1.3: Live/Connected requires an active tenant and matching published, desired and applied revisions from the official integration read. Reconnect reuses connector/provider IDs only within the same tenant. Unknown resolution usage is not displayed as zero. PR #20, deployed revision `20520363a97c9a5b0af2624afdef1e8f5320a82a`.
- 0.1.4: preserve runtime class names during client minification so Shopify's authentication boundary recognizes React Router recovery responses. PR #21.
- 0.1.5: internal navigation retains only verified shop, host and embedded routing context, removing authentication parameters. PR #22, deployed revision `c9f7c8ed03167cb2cc6cc70a318ffede21855d38`. CI passed 512 tests, typecheck, lint and production build.

- 0.1.6: refuse invalid resolution counts, unusable cursors and positive batches repeating the stored cursor before reporting or saving. App Events rejects fractional/unsafe units rather than rounding them. PR #25, deployed revision `8f8748ff7a76bd786341299756a206426c59e991`. Local checks and CI passed 532 tests across 58 suites, typecheck, lint and production build. The new tests fail 15 assertions against the previous source.

- 0.1.7: secret-safe authentication and route diagnostics, preserving exact SDK responses and recovery headers. PR #30, deployed revision `573b3f36ed90e8861760f980b2a518bd7943862e`. Local checks and CI passed 541 tests across 60 suites, typecheck, lint and production build. This improves diagnosis; it does not establish or fix the idle-navigation incident's root cause.

## Observed live

- The corrected activation link opens the intended app embed; the existing development-store embed is enabled.
- Free → Growth → Scale → Free test contracts return to the app with the expected plan. Shopify explicitly identifies these development-store contracts as free to test. The final observed plan is Free / Active.
- Reconnect on 0.1.3 publishes refreshed knowledge without the earlier duplicate-connector warning.
- The official integration read works with the app's tenant-admin identity. The admin now displays Activating or Activation failed when projection has not completed; it no longer certifies that state as Live.
- On 0.1.5, fresh Shopify app entry followed by Store connection navigation produced `/app/connector` with only `shop`, `host` and `embedded` query keys. Reloading that route restored the full Store connection page. The earlier branded HTTP-200 error and subsequent blank recovery page were absent. The separate activation failure remained visible as expected. Billing navigation and reload also restored the selected Free plan and explicit unavailable-usage state.

- On 0.1.6, the rebuilt service started after the completed build; the public capability endpoint returned HTTP 200 with actor verification and launch identity available. The public root and four referenced JavaScript assets returned HTTP 200. Fresh embedded Home reload retained only `shop`, `host` and `embedded` routing parameters, and Billing navigation restored Free / Active with explicit unavailable usage. Reloading `/app/billing` with only those three routing keys also restored Free / Active and the explicit unavailable-usage state.

- AI build 603 activation repair is deployed. The verified integration reported publication, desired and applied revision **6 = 6 = 6**, with matching payload hash `d336dadd065f5fa0d30220ec1b6dd61d2c2dd2b72b727973c2fabae7a9a2d66f`. The applied public embed origins are `https://busymate-ai-review-test-5.myshopify.com`, `https://admin.shopify.com` and `https://online-store-web.shopifyapps.com`. Fresh embedded Home rendered Live with the assistant provisioned and order tools connected. A subsequent widget question still failed as recorded below.

## Still blocking completion

- Storefront response: after activation succeeded, a refund-policy question in the Shopify theme-editor widget returned "AI usage limit reached." The entitlement/quota rejection is under investigation. Activation and working frame origins do not establish that customer questions can be answered. No quota bypass, manual credit or resubmission is claimed.
- Metering: the current usage API has no AI-resolution ledger or cursor. A customer-confirmed versus assistant-declared resolution definition is still needed before implementing and verifying charges and the Free allowance. The 0.1.6 defensive validation does not supply that ledger, serialized delivery, or the Free allowance. App Events acceptance alone is not proof that a charge was processed; Shopify billing logs must verify processing. Do not substitute messages, model steps, human handoff closures or fabricated zero usage.

## Review access

No separate Busymate account is needed; Shopify authenticates the embedded app. The instructions in `testing-instructions.md` explain review-store setup, theme activation and test billing. They were saved to Shopify's review form and verified after reloading the page (2,437 characters, no-separate-account option retained). This does not constitute resubmission. Keep credentials and identifiable customer evidence out of this public repository.

## Idle navigation follow-up (unresolved)

A later idle internal navigation rendered a 500. Fresh Shopify app entry recovered.
Recent app logs showed offline-session exchanges and an aborted data request, but
no underlying exception establishing a root cause. This observation is not closed
by the earlier successful reload checks.

The diagnostics patch for issue #29 preserves SDK status/headers and records only
safe method, allowlisted static path, status, error class/code and abort state.
It does not log messages, stacks, queries, headers, bodies or identities. An
installed-SDK test with synthetic token-exchange responses demonstrates failure
and successful retry without altering control flow; it is not a reproduction of
the live root cause. Local validation: 541 tests, typecheck, lint and build passed.
Diagnostics were deployed as 0.1.7. The rebuilt service is active, the public capability endpoint returned HTTP 200 with actor verification and launch identity available, and the public root plus four referenced JavaScript assets returned HTTP 200. Renewed idle-navigation reproduction remains outstanding.
