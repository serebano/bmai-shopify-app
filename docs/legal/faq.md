<!--
  Merchant/shopper FAQ for "Busymate AI for Shopify". Published at
  https://store.busymate.ai/legal/faq (the faq_url in listing/*.json).
  Last drafted: 2026-08.
-->

# Busymate AI for Shopify — FAQ

## What does the app do?
It adds **bro**, an AI support assistant, to your storefront. bro answers only from
your own products and policies — grounded and source-cited, and it says so when it
isn't sure — handles order-status questions, and can process returns, refunds and
cancellations with your confirmation and a spend cap. It replies in your shoppers'
languages and hands off to your team when confidence is low.

## How does it install?
One click from the Shopify App Store. On install we provision your store's assistant,
auto-train it on your catalogue and policies, and add a theme app-embed block — no
theme code editing. Enable it in **Theme editor → App embeds**.

## Where does the assistant get its answers?
Only from **your** store: your products, pages and policies. Answers are cited, and
the assistant refuses or offers a human handoff when it isn't confident. It does not
make up store facts.

## Can it really take order actions?
Yes — for signed-in shoppers, scoped to **their own** orders. It can look up status
and tracking, and (with confirmation) update a shipping address, start a return, cancel
an unfulfilled order, or issue a refund. Refunds are capped; above the cap it escalates
to a human instead of auto-refunding. Higher-risk actions always require confirmation.

## Which permissions do you request, and why?
Least-privilege Shopify scopes: read products, content, orders, customers and
fulfilments (to answer and look up orders), and write orders + returns (to perform the
confirmed actions above). Access to orders older than 60 days is requested separately
at review time.

## How does billing work?
You pay per **resolved** conversation, through Shopify Billing — no external checkout.
You set a monthly spend **cap**; the cap limits charges, not the assistant. The
storefront widget **keeps working past the cap** — it is never switched off for
billing.

## Is my data safe? What do you store?
We store the minimum needed to run the integration (store/tenant identifiers, your
Shopify access token, billing status). The access token and staff email are
**encrypted at rest**. We do **not** store shopper order history, addresses or payment
data — order data is read live and scoped to the signed-in shopper. See the
[Privacy Policy](https://busymate.ai/legal/privacy).

## What happens to data if I uninstall?
On uninstall we suspend your assistant and purge sessions immediately. Shopify's
`shop/redact` (about 48 hours later) triggers a full teardown and purge. Shoppers can
request data export or erasure at any time; we execute those through Shopify's
mandatory privacy webhooks.

## Which languages are supported?
14: English, Spanish, Portuguese (BR), French, German, Italian, Russian, Romanian,
Turkish, Arabic (RTL), Simplified Chinese, Hindi, Japanese and Korean — auto-detected.

## How do I get help?
Email **support@busymate.ai** or use the in-app support from the embedded admin.
