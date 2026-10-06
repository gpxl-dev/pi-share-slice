import { describe, expect, test } from "bun:test";
import { patchPiViewerHtml, ViewerPatchError } from "./viewer-patch.ts";

const compatibleViewer = `<!doctype html>
<html>
<head>
  <style>
  body { color: black; }
  </style>
</head>
<body>
<button id="hamburger" title="Open sidebar"><svg></svg></button>
<div id="sidebar-overlay"></div>
<aside id="sidebar">
<button class="filter-btn active" data-filter="default" title="Hide settings entries">Default</button>
</aside>
<div id="sidebar-resizer" role="separator" aria-orientation="vertical"></div>
<script>
let filterMode = 'default';
switch (filterMode) {
            case 'user-only':
              passesFilter = entry.type === 'message' && entry.message.role === 'user';
              break;
}
function renderHeader() {
  return \`<div class="header">
<h1>Session: \${escapeHtml(header?.id || 'unknown')}</h1>
<div class="help-bar">
<span class="help-hint">T toggle thinking · O toggle tools</span>
<button type="button" class="header-toggle-btn" data-action="toggle-thinking" title="Toggle thinking (T)">Toggle thinking</button>
<button type="button" class="header-toggle-btn" data-action="toggle-tools" title="Toggle tools (O)">Toggle tools</button>
<button type="button" class="download-json-btn">JSONL</button>
</div>
<div class="header-info">
<div class="info-item"><span class="info-label">Date:</span><span class="info-value">\${date}</span></div>
<div class="info-item"><span class="info-label">Models:</span><span class="info-value">\${models}</span></div>
<div class="info-item"><span class="info-label">Messages:</span><span class="info-value">\${msgParts.join(', ') || '0'}</span></div>
<div class="info-item"><span class="info-label">Tool Calls:</span><span class="info-value">\${globalStats.toolCalls}</span></div>
<div class="info-item"><span class="info-label">Tokens:</span><span class="info-value">\${tokenParts.join(' ') || '0'}</span></div>
<div class="info-item"><span class="info-label">Cost:</span><span class="info-value">\${totalCost.toFixed(3)}</span></div>
</div>
</div>\`;
}
</script>
</body>
</html>`;

// Pi 1.0.4 adds hidden-message controls, pressed states, and a currency prefix.
const currentViewer = compatibleViewer
  .replace('O toggle tools</span>', 'O toggle tools · H toggle hidden messages</span>')
  .replace('data-action="toggle-thinking"', 'data-action="toggle-thinking" aria-pressed="${thinkingExpanded}"')
  .replace('data-action="toggle-tools"', 'data-action="toggle-tools" aria-pressed="${toolOutputsExpanded}"')
  .replace('<button type="button" class="download-json-btn">',
    '<button type="button" class="header-toggle-btn" data-action="toggle-hidden-messages" aria-pressed="${showHiddenMessages}" title="Show custom messages marked as hidden in the terminal (H).">${showHiddenMessages ? \'Hide hidden messages\' : \'Show hidden messages\'}</button>\n<button type="button" class="download-json-btn">')
  .replace('${totalCost.toFixed(3)}', () => '$${totalCost.toFixed(3)}');

describe("Pi viewer patch", () => {
  test("adds and activates a user-and-assistant filter without removing Pi's filters", () => {
    const patched = patchPiViewerHtml(compatibleViewer);

    expect(patched).toContain(
      '<button class="filter-btn active" data-filter="user-assistant-only" data-pi-share-slice-patch="1"',
    );
    expect(patched).toContain(
      '<button class="filter-btn" data-filter="default" title="Hide settings entries">Default</button>',
    );
    expect(patched).toContain("let filterMode = 'user-assistant-only';");
    expect(patched).toContain("entry.message.role === 'user' || entry.message.role === 'assistant'");
    expect(patched).toContain("case 'user-only':");
    expect(patched).toContain('<aside id="sidebar">');
    expect(patched).toContain("Toggle thinking");
    expect(patched).toContain("Messages:");
  });

  test("adds a system-following light and Tokyo Night theme", () => {
    const patched = patchPiViewerHtml(compatibleViewer);

    expect(patched).toContain("color-scheme: light dark");
    expect(patched).toContain("@media (prefers-color-scheme: dark)");
    expect(patched).toContain("--body-bg: #f8f8f8");
    expect(patched).toContain("--body-bg: #1a1b26");
    expect(patched).toContain("--container-bg: #24283b");
    expect(patched).toContain("--accent: #7dcfff");
    expect(patched).toContain("--syntaxKeyword: #bb9af7");
  });

  test.each([
    ["0.84.3", compatibleViewer],
    ["1.0.4", currentViewer],
  ] as const)("optionally hides the sidebar and toggles and condenses the summary on Pi %s", (_version, viewer) => {
    const patched = patchPiViewerHtml(viewer, {
      hideSidebar: true,
      hideHeaderToggles: true,
      condenseSummary: true,
    });

    expect(patched).toContain("#sidebar, #sidebar-resizer, #hamburger, #sidebar-overlay { display: none !important; }");
    expect(patched).not.toContain('class="help-hint"');
    expect(patched).not.toContain('class="header-toggle-btn"');
    expect(patched).toContain('class="download-json-btn"');
    expect(patched).not.toContain("<h1>Session:");
    expect(patched).toContain("Date:");
    expect(patched).toContain("Models:");
    expect(patched).not.toContain("Messages:");
    expect(patched).not.toContain("Tool Calls:");
    expect(patched).not.toContain("Tokens:");
    expect(patched).not.toContain("Cost:");
  });

  test("fails clearly instead of partially patching an incompatible viewer", () => {
    expect(() => patchPiViewerHtml(compatibleViewer.replace("case 'user-only':", "case 'users':")))
      .toThrow(ViewerPatchError);
    expect(() => patchPiViewerHtml(compatibleViewer.replace("case 'user-only':", "case 'users':")))
      .toThrow("Disable 'Patch shared viewer'");
  });

  test("validates only the enabled optional customizations", () => {
    const withoutSidebar = compatibleViewer.replace('<aside id="sidebar">', '<aside id="tree">');
    expect(() => patchPiViewerHtml(withoutSidebar)).not.toThrow();
    expect(() => patchPiViewerHtml(withoutSidebar, { hideSidebar: true })).toThrow("sidebar anchor");
  });

  test("keeps current header controls and cost when customizations are disabled", () => {
    const patched = patchPiViewerHtml(currentViewer);
    expect(patched).toContain('data-action="toggle-hidden-messages"');
    expect(patched).toContain('aria-pressed="${thinkingExpanded}"');
    expect(patched).toContain('$${totalCost.toFixed(3)}');
  });

  test("rejects missing, duplicate, and unknown header variants", () => {
    const options = { hideHeaderToggles: true };
    expect(() => patchPiViewerHtml(currentViewer.replace('class="help-hint"', 'class="new-hint"'), options))
      .toThrow("header toggle hint");
    expect(() => patchPiViewerHtml(currentViewer.replace('data-action="toggle-hidden-messages"', 'data-action="hidden"'), options))
      .toThrow("hidden messages toggle button");
    expect(() => patchPiViewerHtml(currentViewer.replace('aria-pressed="${thinkingExpanded}"', 'aria-pressed="true"'), options))
      .toThrow("thinking toggle button");
    expect(() => patchPiViewerHtml(currentViewer + '<span class="help-hint">T toggle thinking · O toggle tools</span>', options))
      .toThrow("header toggle hint");
    const thinkingButton = compatibleViewer.match(/<button[^\n]+data-action="toggle-thinking"[^\n]+/u)![0];
    expect(() => patchPiViewerHtml(currentViewer + thinkingButton, options)).toThrow("thinking toggle button");
    expect(() => patchPiViewerHtml(compatibleViewer + thinkingButton, options)).toThrow("thinking toggle button");
  });

  test("rejects duplicate cost variants", () => {
    const legacyCost = compatibleViewer.split("\n").find((line) => line.includes("Cost:</span>"))!;
    expect(() => patchPiViewerHtml(currentViewer + legacyCost, { condenseSummary: true })).toThrow("summary detail 4");
  });

  test("rejects an accidental second patch", () => {
    expect(() => patchPiViewerHtml(patchPiViewerHtml(compatibleViewer))).toThrow(ViewerPatchError);
  });
});
