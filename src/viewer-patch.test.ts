import { describe, expect, test } from "bun:test";
import { patchPiViewerHtml, ViewerPatchError } from "./viewer-patch.ts";

const compatibleViewer = `<!doctype html>
<button class="filter-btn active" data-filter="default" title="Hide settings entries">Default</button>
<script>
let filterMode = 'default';
switch (filterMode) {
            case 'user-only':
              passesFilter = entry.type === 'message' && entry.message.role === 'user';
              break;
}
</script>`;

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
  });

  test("fails clearly instead of partially patching an incompatible viewer", () => {
    expect(() => patchPiViewerHtml(compatibleViewer.replace("case 'user-only':", "case 'users':")))
      .toThrow(ViewerPatchError);
    expect(() => patchPiViewerHtml(compatibleViewer.replace("case 'user-only':", "case 'users':")))
      .toThrow("Disable 'Patch shared viewer'");
  });

  test("rejects an accidental second patch", () => {
    expect(() => patchPiViewerHtml(patchPiViewerHtml(compatibleViewer))).toThrow(ViewerPatchError);
  });
});
