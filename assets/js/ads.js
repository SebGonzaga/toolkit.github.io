/* ==========================================================================
   Pick & Race — ad helper (display ads only)

   One switch decides which network is used:  PROVIDER = "none" | "adsterra" | "adsense"
   Both networks' IDs live in the CONFIG block below (the ONLY place they are set).

   Pages just contain:  <aside class="ad-slot" data-ad="tool-bottom"></aside>
   This file builds the label + ad box, loads the network once, and starts each
   slot exactly once, only when it is near the screen.

   Slots:  home / tool-top      -> wide banner on desktop, phone banner on small screens
           tool-bottom          -> 300x250 (fits every screen)
           home-bottom          -> Adsterra native banner (AdSense mode skips it)

   Add ?adpreview to any URL to see dashed placeholder boxes and check spacing
   without real ads.
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------ CONFIG ------------------------------ */
  var PROVIDER = "adsense";                        // "none" = no ads at all. Use "adsterra" or "adsense" to turn ads on

  var ADSTERRA = {
    host: "https://bauval.org",
    banners: {
      "300x250": { key: "5e8d29cc5c8f11b1e2ceb8b78595751f", w: 300, h: 250 },
      "728x90":  { key: "bf99a2a87f1349d384f1999971d0b28e", w: 728, h: 90  },
      "320x50":  { key: "bca80f12c4d05ca7a19bc37cb9305a76", w: 320, h: 50  }
    },
    nativeId: "2126901972155ca6c4dc9b3f691faa1a"
  };

  var CLIENT = "ca-pub-8362200361779290";          // AdSense publisher ID (used only when PROVIDER = "adsense")
  var SLOTS = {                                     // AdSense ad unit slot IDs
    "home":        "5369012132",   // home page, below the hero
    "tool-top":    "7201802700",   // race pages, above the race area
    "tool-bottom": "9879013494",   // every tool, below the stage / results
    // extra placements reuse the same responsive units (AdSense allows one unit in several places)
    "tool-mid":    "9879013494",   // every tool, between the stage and the explanation text
    "home-mid":    "5369012132",   // home page, between the tool list and the how-to text
    "home-bottom": "5369012132"    // home page, bottom
  };
  /* -------------------------------------------------------------------- */

  if (PROVIDER === "none") return;                 // ads are switched off: do nothing

  var ADSENSE = PROVIDER === "adsense";
  var isPlaceholder = function (v) { return /X{6,}/.test(v); };
  var preview = /[?&]adpreview\b/.test(location.search);
  var live = !preview && (ADSENSE ? !isPlaceholder(CLIENT) : true);   // ?adpreview never shows real ads

  var nodes = Array.prototype.slice.call(document.querySelectorAll(".ad-slot[data-ad]"));
  // AdSense has no unit for the native slot; skip any slot it has no ID for.
  if (ADSENSE) nodes = nodes.filter(function (n) { return !!SLOTS[n.getAttribute("data-ad")]; });
  if (!nodes.length || (!live && !preview)) return;

  /* ------------------------------ shared ------------------------------ */
  function addLabel(node) {
    var label = document.createElement("div");
    label.className = "ad-label";
    label.textContent = "Advertisement";
    node.appendChild(label);
  }

  function slotWidth(node) {
    var w = node.getBoundingClientRect().width;
    if (!w && node.parentNode) w = node.parentNode.clientWidth;
    return w || 0;
  }

  /* ------------------------------ Adsterra ---------------------------- */
  // Adsterra banner units read one global (window.atOptions) when their script runs,
  // so banners are started one at a time.
  var queue = [], busy = false;
  function enqueue(job) { queue.push(job); if (!busy) nextJob(); }
  function nextJob() {
    var job = queue.shift();
    if (!job) { busy = false; return; }
    busy = true;
    var finished = false;
    function done() { if (finished) return; finished = true; nextJob(); }
    job(done);
    setTimeout(done, 5000);                          // never let one slow script block the rest
  }

  function chooseAdsterra(key, width) {
    if (key === "home-bottom") return { type: "native" };
    var b = ADSTERRA.banners;
    if (key === "tool-bottom") return width >= 300 ? { type: "banner", unit: b["300x250"] } : null;
    // home / tool-top: wide on desktop, phone banner on small screens
    if (width >= 728) return { type: "banner", unit: b["728x90"] };
    if (width >= 320) return { type: "banner", unit: b["320x50"] };
    return null;
  }

  function buildAdsterra(node) {
    var key = node.getAttribute("data-ad");
    var choice = chooseAdsterra(key, slotWidth(node));
    if (!choice) return null;                        // too narrow for any banner: show nothing

    var box = document.createElement("div");
    box.className = "ad-box";
    if (choice.type === "native") {
      var holder = document.createElement("div");
      holder.id = "container-" + ADSTERRA.nativeId;
      box.appendChild(holder);
    } else {
      box.style.width = choice.unit.w + "px";
      box.style.maxWidth = "100%";
      box.style.minHeight = choice.unit.h + "px";    // reserve space so the page doesn't jump
      box.style.margin = "0 auto";
    }
    return { node: node, box: box, choice: choice };
  }

  function activateAdsterra(u) {
    if (u.started) return;
    u.started = true;
    u.node.classList.add("is-shown");                // needs real size before the ad loads

    if (u.choice.type === "native") {
      var s = document.createElement("script");
      s.async = true;
      s.setAttribute("data-cfasync", "false");
      s.src = ADSTERRA.host + "/21/" + ADSTERRA.nativeId;
      u.box.appendChild(s);
    } else {
      enqueue(function (done) {
        var unit = u.choice.unit;
        window.atOptions = { key: unit.key, format: "iframe", height: unit.h, width: unit.w, params: {} };
        var s = document.createElement("script");
        s.src = ADSTERRA.host + "/22/" + unit.key;
        s.onload = s.onerror = done;
        u.box.appendChild(s);
      });
    }

    // Nothing showed up after a few seconds (blocker, no inventory...)? Collapse the
    // space so visitors never see an empty gap.
    setTimeout(function () {
      var filled = u.choice.type === "native"
        ? u.box.querySelector("#container-" + ADSTERRA.nativeId + " *")
        : u.box.querySelector("iframe");
      if (!filled) u.node.classList.remove("is-shown");
    }, 7000);
  }

  /* ------------------------------ AdSense ----------------------------- */
  function buildAdsense(node) {
    var key = node.getAttribute("data-ad");
    var ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.setAttribute("data-ad-client", CLIENT);
    ins.setAttribute("data-ad-slot", SLOTS[key] || "");
    ins.setAttribute("data-ad-format", "auto");
    ins.setAttribute("data-full-width-responsive", "true");

    // AdSense marks each unit filled/unfilled: collapse the box if nothing came back.
    new MutationObserver(function () {
      var status = ins.getAttribute("data-ad-status");
      if (status === "unfilled") node.classList.remove("is-shown");
      else if (status === "filled") node.classList.add("is-shown");
    }).observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
    return { node: node, box: ins, ins: ins };
  }

  var scriptRequested = false;
  function loadAdsenseScript() {
    // skip if the AdSense tag is already on the page (e.g. added for site verification)
    if (scriptRequested || window.__prAdScript || document.querySelector('script[src*="adsbygoogle.js"]')) return;
    scriptRequested = window.__prAdScript = true;
    var s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(CLIENT);
    document.head.appendChild(s);
  }

  function activateAdsense(u) {
    var ins = u.ins;
    if (!ins || ins.dataset.adPushed) return;        // one push per slot, ever
    if (isPlaceholder(SLOTS[u.node.getAttribute("data-ad")] || "XXXXXX")) return;
    ins.dataset.adPushed = "1";
    u.node.classList.add("is-shown");                // needs real width before push
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* ignore */ }
    setTimeout(function () {
      if (ins.getAttribute("data-ad-status") !== "filled") u.node.classList.remove("is-shown");
    }, 4000);
  }

  /* ------------------------------- start ------------------------------ */
  function build(node) {
    if (node.dataset.adBuilt) return null;           // never build twice
    node.dataset.adBuilt = "1";

    if (!live) {                                     // preview mode
      addLabel(node);
      var box = document.createElement("div");
      box.className = "ad-preview";
      box.textContent = "Ad preview: " + node.getAttribute("data-ad");
      node.appendChild(box);
      node.classList.add("is-shown");
      return null;
    }

    var u = ADSENSE ? buildAdsense(node) : buildAdsterra(node);
    if (!u) return null;
    addLabel(node);
    node.appendChild(u.box);
    return u;
  }

  function activate(u) { return ADSENSE ? activateAdsense(u) : activateAdsterra(u); }

  function start() {
    var units = nodes.map(function (n) { return build(n); }).filter(Boolean);

    if (live) {
      if (ADSENSE) loadAdsenseScript();
      // Start each slot only when it is about to scroll into view.
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            io.unobserve(e.target);
            var u = units.filter(function (x) { return x.node === e.target; })[0];
            if (u) activate(u);
          });
        }, { rootMargin: "300px 0px" });
        units.forEach(function (u) { io.observe(u.node); });
      } else {
        units.forEach(activate);
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
