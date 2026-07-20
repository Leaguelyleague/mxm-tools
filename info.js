// info.js — Renders the page translations (data-i18n / data-i18n-html)
// and adjusts the key symbols to the reader's operating system
// (on Windows/Linux, ⌥ → Alt and ⌘ → Ctrl inside the <kbd>).
(function () {
  const I18N = window.MXMI18n;
  const IS_MAC = /mac/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "");

  function render() {
    I18N.applyDom(document);
    if (IS_MAC) return; // on mac the symbols are left as-is
    document.querySelectorAll("kbd").forEach((k) => {
      k.textContent = k.textContent.replace(/⌥/g, "Alt+").replace(/⌘/g, "Ctrl+");
    });
  }

  I18N.onChange(render);
  render();
})();
