// play/v1 bridge, loaded by every game page on origin G (see docs/hub/PLAN.md §3.1).
// Tells the arcade page on origin A when the game has loaded or crashed, and relays pause/resume as DOM events.
// Opened outside a frame it does nothing.
(function () {
  var HOSTS = /^https:\/\/([a-z0-9-]+\.)?arctanmyangle\.pages\.dev$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  if (window.parent === window) return;

  function send(type, detail) {
    // The parent's origin isn't known up front (production, a branch preview or localhost); the payload carries
    // nothing private, and the host checks event.origin before trusting it.
    window.parent.postMessage({ v: 1, type: type, detail: detail }, "*");
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !HOSTS.test(e.origin)) return;
    var d = e.data;
    if (!d || d.v !== 1) return;
    if (d.type === "pause" || d.type === "resume") document.dispatchEvent(new CustomEvent("play:" + d.type));
  });

  window.addEventListener("error", function (e) {
    send("error", String(e.message || "error").slice(0, 200));
  });

  if (document.readyState === "complete") send("ready");
  else window.addEventListener("load", function () { send("ready"); });
})();
