/**
 * Storefront mount for the Busymate AI white-label widget.
 *
 * Loads the platform embed (`/embed/v1.js`) via @busymate/whitelabel-sdk's
 * mountBusymateAI contract. getIdentity hits the app's App Proxy /identity route,
 * which mints a short-lived ES256 launch JWT scoped to the logged-in Shopify
 * customer (guests → null → anonymous chat still works).
 *
 * i18n: the launcher label, its accessible name (aria-label) and title arrive on
 * this script's data-* attributes, already translated by the theme block
 * (`locales/*.json` via the Liquid `t` filter), and are forwarded to the embed.
 *
 * The SDK is vendored/inlined at build (`shopify app deploy`) so the storefront
 * pulls a single asset. Until wired, this is a zero-dependency inline mount that
 * matches the SDK's window.BusymateAI + <script data-assistant> contract.
 */
(function () {
  var el = document.currentScript;
  if (!el) return;
  var slug = el.getAttribute("data-slug");
  var origin = el.getAttribute("data-origin") || "https://busymate.ai";
  var label = el.getAttribute("data-label") || "";
  var ariaLabel = el.getAttribute("data-aria-label") || label;
  var title = el.getAttribute("data-title") || label;
  var locale = el.getAttribute("data-locale") || "";
  var loggedIn = el.getAttribute("data-logged-in") === "true";
  if (!slug) return;

  // The App Proxy path the merchant configures (Proxy URL → this app's /identity).
  // Shopify appends logged_in_customer_id + a verifiable signature server-side.
  var IDENTITY_URL = "/apps/busymate-ai/identity";

  window.BusymateAI = {
    getIdentity: function () {
      if (!loggedIn) return Promise.resolve(null); // guest → anonymous chat
      return fetch(IDENTITY_URL, { method: "POST", credentials: "include" })
        .then(function (r) {
          return r.ok && r.status !== 204 ? r.json() : null; // { token, nonce } | null
        })
        .catch(function () {
          return null;
        });
    },
  };

  var s = document.createElement("script");
  s.src = origin.replace(/\/$/, "") + "/embed/v1.js";
  s.async = true;
  s.setAttribute("data-assistant", slug);
  if (label) s.setAttribute("data-label", label);
  if (ariaLabel) s.setAttribute("data-aria-label", ariaLabel);
  if (title) s.setAttribute("data-title", title);
  if (locale) s.setAttribute("data-locale", locale);
  document.head.appendChild(s);
})();
