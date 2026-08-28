/**
 * Storefront mount for the bmai white-label widget.
 *
 * Loads the platform embed (`/embed/v1.js`) via @busymate/whitelabel-sdk's
 * mountBusymateAI contract. getIdentity hits the app's App Proxy /identity route,
 * which mints a short-lived ES256 launch JWT scoped to the logged-in Shopify
 * customer (guests → null → anonymous chat still works).
 *
 * The SDK is vendored/inlined at build (`shopify app deploy`) so the storefront
 * pulls a single asset. Until wired, this is a zero-dependency inline mount that
 * matches the SDK's window.BusymateAI + <script data-assistant> contract.
 *
 */
(function () {
  var el = document.currentScript;
  if (!el) return;
  var slug = el.getAttribute("data-slug");
  var origin = el.getAttribute("data-origin") || "https://busymate.ai";
  var label = el.getAttribute("data-label") || "Ask us";
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
  s.setAttribute("data-label", label);
  document.head.appendChild(s);
})();
