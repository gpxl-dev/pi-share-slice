import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_FILTER_BUTTON =
  '<button class="filter-btn active" data-filter="default" title="Hide settings entries">Default</button>';
const DEFAULT_FILTER_DECLARATION = "let filterMode = 'default';";
const USER_ONLY_FILTER_CASE = `case 'user-only':
              passesFilter = entry.type === 'message' && entry.message.role === 'user';
              break;`;
const STYLE_END = "\n  </style>\n</head>";

const HELP_HINT = '<span class="help-hint">T toggle thinking · O toggle tools</span>';
const THINKING_TOGGLE =
  '<button type="button" class="header-toggle-btn" data-action="toggle-thinking" title="Toggle thinking (T)">Toggle thinking</button>';
const TOOLS_TOGGLE =
  '<button type="button" class="header-toggle-btn" data-action="toggle-tools" title="Toggle tools (O)">Toggle tools</button>';

const SESSION_HEADING = "<h1>Session: ${escapeHtml(header?.id || 'unknown')}</h1>";
const SUMMARY_DETAIL_ITEMS = [
  "<div class=\"info-item\"><span class=\"info-label\">Messages:</span><span class=\"info-value\">${msgParts.join(', ') || '0'}</span></div>",
  "<div class=\"info-item\"><span class=\"info-label\">Tool Calls:</span><span class=\"info-value\">${globalStats.toolCalls}</span></div>",
  "<div class=\"info-item\"><span class=\"info-label\">Tokens:</span><span class=\"info-value\">${tokenParts.join(' ') || '0'}</span></div>",
  "<div class=\"info-item\"><span class=\"info-label\">Cost:</span><span class=\"info-value\">${totalCost.toFixed(3)}</span></div>",
] as const;

const SIDEBAR_ANCHORS = [
  '<button id="hamburger" title="Open sidebar">',
  '<div id="sidebar-overlay"></div>',
  '<aside id="sidebar">',
  '<div id="sidebar-resizer" role="separator"',
] as const;

export interface ViewerPatchOptions {
  hideSidebar?: boolean;
  hideHeaderToggles?: boolean;
  condenseSummary?: boolean;
}

export class ViewerPatchError extends Error {
  constructor(part: string) {
    super(
      `Pi's exported viewer no longer matches the supported template (${part}). ` +
      "Disable 'Patch shared viewer' in /share-slice-settings to use Pi's unmodified viewer.",
    );
    this.name = "ViewerPatchError";
  }
}

function occurrenceCount(value: string, search: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = value.indexOf(search, offset);
    if (index < 0) return count;
    count++;
    offset = index + search.length;
  }
}

function assertUnique(html: string, search: string, part: string): void {
  if (occurrenceCount(html, search) !== 1) throw new ViewerPatchError(part);
}

function replaceUnique(html: string, search: string, replacement: string, part: string): string {
  assertUnique(html, search, part);
  return html.replace(search, replacement);
}

/**
 * Apply narrow, version-checked changes to Pi's generated viewer.
 *
 * Pi owns the rest of the HTML, CSS, and JavaScript. Exact anchors make each
 * enabled customization fail before upload instead of silently producing a
 * partially modified viewer after a Pi template change.
 */
export function patchPiViewerHtml(html: string, options: ViewerPatchOptions = {}): string {
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

  if (options.hideSidebar) {
    for (const [index, anchor] of SIDEBAR_ANCHORS.entries()) {
      assertUnique(patched, anchor, `sidebar anchor ${index + 1}`);
    }
    patched = replaceUnique(
      patched,
      STYLE_END,
      `
    /* pi-share-slice: hide the session tree */
    #sidebar, #sidebar-resizer, #hamburger, #sidebar-overlay { display: none !important; }
${STYLE_END}`,
      "viewer style block",
    );
  }

  if (options.hideHeaderToggles) {
    patched = replaceUnique(patched, HELP_HINT, "", "header toggle hint");
    patched = replaceUnique(patched, THINKING_TOGGLE, "", "thinking toggle button");
    patched = replaceUnique(patched, TOOLS_TOGGLE, "", "tools toggle button");
  }

  if (options.condenseSummary) {
    patched = replaceUnique(patched, SESSION_HEADING, "", "session heading");
    for (const [index, item] of SUMMARY_DETAIL_ITEMS.entries()) {
      patched = replaceUnique(patched, item, "", `summary detail ${index + 1}`);
    }
  }

  return patched;
}

export function patchPiViewerFile(path: string, options: ViewerPatchOptions = {}): void {
  const html = readFileSync(path, "utf8");
  const patched = patchPiViewerHtml(html, options);
  writeFileSync(path, patched, "utf8");
}
