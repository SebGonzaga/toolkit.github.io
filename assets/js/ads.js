/* ==========================================================================
   Pick & Race — AdSense helper (display ads only)

   1. Your IDs live in the CONFIG block below (the ONLY place they are set).
   2. Pages just contain:  <aside class="ad-slot" data-ad="tool-bottom"></aside>
      This file builds the label + <ins> unit, loads AdSense once, and
      initialises each slot exactly once, only when it is near the screen.

   Nothing renders (and no AdSense request is made) while the IDs are still
   placeholders. Add ?adpreview to any URL to see dashed placeholder boxes
   and check spacing without real ads.
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------ CONFIG ------------------------------ */
  var CLIENT = "ca-pub-8362200361779290";          // your AdSense publisher ID
  var SLOTS = {                                     // <-- your ad unit slot IDs
    "home":        "5369012132",   // home page, below the hero
    "tool-top":    "7201802700",   // race pages, above the race area
    "tool-bottom": "9879013494"    // every tool, below the stage / results
  };
  /* -------------------------------------------------------------------- */

  var isPlaceholder = function (v) { return /X{6,}/.test(v); };
  var preview = /[?&]adpreview\b/.test(location.search);
  var live = !isPlaceholder(CLIENT) && !preview;   // ?adpreview always shows dashed boxes, never real ads

  var nodes = Array.prototype.slice.call(document.querySelectorAll(".ad-slot[data-ad]"));
  if (!nodes.length || (!live && !preview)) return;   // placeholder IDs: stay invisible

  function build(node) {
    if (node.dataset.adBuilt) return null;             // never build twice
    node.dataset.adBuilt = "1";
    var key = node.getAttribute("data-ad");
    var label = document.createElement("div");
    label.className = "ad-label";
    label.textContent = "Advertisement";
    node.appendChild(label);

    if (!live) {                                       // preview mode
      var box = document.createElement("div");
      box.className = "ad-preview";
      box.textContent = "Ad preview: " + key;
      node.appendChild(box);
      node.classList.add("is-shown");
      return null;
    }

    var ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.setAttribute("data-ad-client", CLIENT);
    ins.setAttribute("data-ad-slot", SLOTS[key] || "");
    ins.setAttribute("data-ad-format", "auto");
    ins.setAttribute("data-full-width-responsive", "true");
    node.appendChild(ins);

    // AdSense marks each unit filled/unfilled: collapse the box if nothing came back.
    new MutationObserver(function () {
      var status = ins.getAttribute("data-ad-status");
      if (status === "unfilled") node.classList.remove("is-shown");
      else if (status === "filled") node.classList.add("is-shown");
    }).observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
    return ins;
  }

  var scriptRequested = false;
  function loadScript() {
    // skip if the AdSense tag is already on the page (e.g. added for site verification)
    if (scriptRequested || window.__prAdScript || document.querySelector('script[src*="adsbygoogle.js"]')) return;
    scriptRequested = window.__prAdScript = true;
    var s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(CLIENT);
    document.head.appendChild(s);
  }

  function activate(node, ins) {
    if (!ins || ins.dataset.adPushed) return;          // one push per slot, ever
    if (isPlaceholder(SLOTS[node.getAttribute("data-ad")] || "XXXXXX")) return;
    ins.dataset.adPushed = "1";
    node.classList.add("is-shown");                    // needs real width before push
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* ignore */ }
    // No ad back after a few seconds (account not approved yet, no inventory,
    // blocker...)? Collapse the space so visitors never see an empty gap.
    // If an ad does arrive later, the observer above brings the slot back.
    setTimeout(function () {
      if (ins.getAttribute("data-ad-status") !== "filled") node.classList.remove("is-shown");
    }, 4000);
  }

  function start() {
    var units = nodes.map(function (n) { return { node: n, ins: build(n) }; });

    if (live) {
      loadScript();
      // Initialise each slot only when it is about to scroll into view.
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            io.unobserve(e.target);
            var u = units.filter(function (x) { return x.node === e.target; })[0];
            if (u) activate(u.node, u.ins);
          });
        }, { rootMargin: "300px 0px" });
        units.forEach(function (u) { io.observe(u.node); });
      } else {
        units.forEach(function (u) { activate(u.node, u.ins); });
      }
    }

    // The floating sound button must never sit on top of an ad: hide it
    // while any ad is on screen (the sound toggle returns as you scroll on).
    if ("IntersectionObserver" in window) {
      var onScreen = new Set();
      var fabWatch = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          // only count ads that are actually showing
          if (e.isIntersecting && e.target.classList.contains("is-shown")) onScreen.add(e.target);
          else onScreen.delete(e.target);
        });
        document.body.classList.toggle("ad-in-view", onScreen.size > 0);
      });
      nodes.forEach(function (n) { fabWatch.observe(n); });
    }
  }

  // Keep ads off the critical path: start once the page (and game) has loaded.
  function whenIdle() {
    if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 2500 });
    else setTimeout(start, 600);
  }
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle, { once: true });
})();
