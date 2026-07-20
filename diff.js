// Built-in diff view. Line-based diff with LCS. No dependencies.
const t = (k, p) => window.MXMI18n.t(k, p);

function lcsDiff(aLines, bLines) {
  const n = aLines.length, m = bLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = aLines[i] === bLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) { out.push({ t: "same", a: aLines[i], b: bLines[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "del", a: aLines[i] }); i++; }
    else { out.push({ t: "add", b: bLines[j] }); j++; }
  }
  while (i < n) { out.push({ t: "del", a: aLines[i++] }); }
  while (j < m) { out.push({ t: "add", b: bLines[j++] }); }
  return out;
}

function render(rows) {
  const left = document.getElementById("left");
  const right = document.getElementById("right");
  for (const r of rows) {
    if (r.t === "same") {
      left.appendChild(lineEl(r.a, "same"));
      right.appendChild(lineEl(r.b, "same"));
    } else if (r.t === "del") {
      left.appendChild(lineEl(r.a, "del"));
      right.appendChild(lineEl("", "same"));
    } else {
      left.appendChild(lineEl("", "same"));
      right.appendChild(lineEl(r.b, "add"));
    }
  }
}
function lineEl(text, cls) {
  const s = document.createElement("span");
  s.className = "line " + cls;
  s.textContent = text === "" ? " " : text;
  return s;
}

window.MXMI18n.applyDom(document);

chrome.storage.local.get("comparePayload", (d) => {
  const p = d.comparePayload;
  if (!p) { document.getElementById("title").textContent = t("diff.noData"); return; }
  document.getElementById("title").textContent =
    `${p.song} — ${p.artist}`
    + (p.restored ? "  ·  " + t("diff.restored") : "")
    + (p.lastContributor ? "  ·  " + t("diff.lastContributor", { name: p.lastContributor }) : "");
  const rows = lcsDiff((p.original || "").split("\n"), (p.edited || "").split("\n"));
  render(rows);

  document.getElementById("openDiffchecker").addEventListener("click", () => {
    chrome.storage.local.set(
      { diffcheckerPayload: { left: p.original || "", right: p.edited || "" } },
      () => window.open("https://www.diffchecker.com/", "_blank")
    );
  });
});
