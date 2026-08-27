import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_FILTER_BUTTON =
  '<button class="filter-btn active" data-filter="default" title="Hide settings entries">Default</button>';
const DEFAULT_FILTER_DECLARATION = "let filterMode = 'default';";
const USER_ONLY_FILTER_CASE = `case 'user-only':
              passesFilter = entry.type === 'message' && entry.message.role === 'user';
              break;`;

export class ViewerPatchError extends Error {
  constructor(part: string) {
    super(
      `Pi's exported viewer no longer matches the supported template (${part}). ` +
      "Disable 'Patch shared viewer' in /share-slice-settings to use Pi's unmodified viewer.",
    );
    this.name = "ViewerPatchError";
  }
}

function replaceUnique(html: string, search: string, replacement: string, part: string): string {
  const first = html.indexOf(search);
  if (first < 0 || first !== html.lastIndexOf(search)) throw new ViewerPatchError(part);
  return `${html.slice(0, first)}${replacement}${html.slice(first + search.length)}`;
}

/**
 * Apply a narrow, version-checked patch to Pi's generated viewer.
 *
 * Pi owns the rest of the HTML, CSS, and JavaScript. Exact anchors make the
 * patch fail before upload instead of silently producing a partially modified
 * viewer after a Pi template change.
 */
export function patchPiViewerHtml(html: string): string {
  let patched = replaceUnique(
    html,
    DEFAULT_FILTER_BUTTON,
    `<button class="filter-btn active" data-filter="user-assistant-only" data-pi-share-slice-patch="1" title="Only user and assistant messages">User + Assistant</button>
<button class="filter-btn" data-filter="default" title="Hide settings entries">Default</button>`,
    "default filter button",
  );
  patched = replaceUnique(
    patched,
    DEFAULT_FILTER_DECLARATION,
    "let filterMode = 'user-assistant-only';",
    "initial filter mode",
  );
  patched = replaceUnique(
    patched,
    USER_ONLY_FILTER_CASE,
    `case 'user-assistant-only':
              passesFilter = entry.type === 'message' && (entry.message.role === 'user' || entry.message.role === 'assistant');
              break;
            ${USER_ONLY_FILTER_CASE}`,
    "filter implementation",
  );
  return patched;
}

export function patchPiViewerFile(path: string): void {
  const html = readFileSync(path, "utf8");
  const patched = patchPiViewerHtml(html);
  writeFileSync(path, patched, "utf8");
}
