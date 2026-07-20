// overlay.js — Content script injected on demand to pick a candidate.
// Guards against double injection: registers the listener only once.
// background.js (showOverlay) injects i18n-strings-content.js + mxm-i18n.js
// before this file, so MXMI18n is available here (all strings go through t()).
(() => {
  if (window.__song2gemOverlay) return;
  window.__song2gemOverlay = true;

  const t = (k, p) => window.MXMI18n.t(k, p);
  let root = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "SHOW_CANDIDATES") {
      render(msg.query, msg.candidates);
    }
  });

  // Removes the overlay from the DOM (internal use: on re-render or after picking a candidate).
  function clear() {
    if (root) {
      root.remove();
      root = null;
    }
    document.removeEventListener("keydown", onKey, true);
  }

  // User-initiated dismissal (Esc/✕/backdrop): besides closing, it notifies the
  // background so it closes the YouTube search tab if applicable.
  function dismiss() {
    const had = !!root;
    clear();
    if (had) {
      try {
        chrome.runtime.sendMessage({ type: "OVERLAY_DISMISSED" });
      } catch (_) {}
    }
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      dismiss();
    }
  }

  function render(query, candidates) {
    clear();
    root = document.createElement("div");
    root.id = "song2gem-overlay";
    root.innerHTML = `
      <div class="s2g-backdrop"></div>
      <div class="s2g-panel" role="dialog">
        <div class="s2g-head">
          <span class="s2g-title"></span>
          <button class="s2g-x"></button>
        </div>
        <div class="s2g-query"><span class="s2g-qlabel"></span> <b></b></div>
        <ul class="s2g-list"></ul>
        <div class="s2g-foot">
          <button class="s2g-yt" type="button"></button>
        </div>
      </div>`;
    root.querySelector(".s2g-panel").setAttribute("aria-label", t("overlay.ariaLabel"));
    root.querySelector(".s2g-title").textContent = t("overlay.title");
    const closeBtn = root.querySelector(".s2g-x");
    closeBtn.title = t("overlay.close");
    closeBtn.textContent = "✕";
    root.querySelector(".s2g-qlabel").textContent = t("overlay.searchLabel");
    root.querySelector(".s2g-query b").textContent = query;
    root.querySelector(".s2g-yt").textContent = t("overlay.seeAllYoutube");
    closeBtn.addEventListener("click", dismiss);
    root.querySelector(".s2g-backdrop").addEventListener("click", dismiss);
    // Manual escape hatch: open the full YouTube results page for this search
    // (in a new tab) and close the overlay.
    root.querySelector(".s2g-yt").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_YOUTUBE_SEARCH", query });
      dismiss();
    });

    const ul = root.querySelector(".s2g-list");
    for (const c of candidates) {
      const li = document.createElement("li");
      li.className = "s2g-item";
      const scoreClass = c.score >= 80 ? "hi" : c.score >= 55 ? "mid" : "lo";
      li.innerHTML = `
        <img class="s2g-thumb" alt="">
        <div class="s2g-meta">
          <div class="s2g-vtitle"></div>
          <div class="s2g-sub"><span class="s2g-chan"></span> · <span class="s2g-dur"></span></div>
        </div>
        <span class="s2g-score ${scoreClass}"></span>`;
      li.querySelector(".s2g-thumb").src = c.thumbnail;
      li.querySelector(".s2g-vtitle").textContent = c.title;
      li.querySelector(".s2g-chan").textContent = c.channel || "—";
      li.querySelector(".s2g-dur").textContent = c.duration || "";
      li.querySelector(".s2g-score").textContent = c.score + "%";
      li.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "CHOOSE", candidate: c, query });
        clear(); // the background closes the YT tab on receiving CHOOSE
      });
      ul.appendChild(li);
    }

    document.documentElement.appendChild(root);
    document.addEventListener("keydown", onKey, true);
  }
})();
