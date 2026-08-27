import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_FILTER_BUTTON =
  '<button class="filter-btn active" data-filter="default" title="Hide settings entries">Default</button>';
const DEFAULT_FILTER_DECLARATION = "let filterMode = 'default';";
const USER_ONLY_FILTER_CASE = `case 'user-only':
              passesFilter = entry.type === 'message' && entry.message.role === 'user';
              break;`;
const STYLE_END = "\n  </style>\n</head>";
const SYSTEM_THEME_CSS = `
    /* pi-share-slice: follow the system theme */
    :root {
      color-scheme: light dark;
      --accent: #5a8080;
      --border: #547da7;
      --borderAccent: #5a8080;
      --borderMuted: #b0b0b0;
      --success: #588458;
      --error: #aa5555;
      --warning: #9a7326;
      --muted: #6c6c6c;
      --dim: #767676;
      --text: #1f2328;
      --thinkingText: #6c6c6c;
      --selectedBg: #d0d0e0;
      --scrollbarThumb: #d0d0e0;
      --searchMatchBg: #d0d0e0;
      --searchMatchText: #1f2328;
      --userMessageBg: #e8e8e8;
      --userMessageText: #1f2328;
      --customMessageBg: #ede7f6;
      --customMessageText: #1f2328;
      --customMessageLabel: #7e57c2;
      --toolPendingBg: #e8e8f0;
      --toolSuccessBg: #e8f0e8;
      --toolErrorBg: #f0e8e8;
      --toolTitle: #1f2328;
      --toolOutput: #6c6c6c;
      --mdHeading: #9a7326;
      --mdLink: #547da7;
      --mdLinkUrl: #767676;
      --mdCode: #5a8080;
      --mdCodeBlock: #588458;
      --mdCodeBlockBorder: #6c6c6c;
      --mdQuote: #6c6c6c;
      --mdQuoteBorder: #6c6c6c;
      --mdHr: #6c6c6c;
      --mdListBullet: #588458;
      --toolDiffAdded: #588458;
      --toolDiffRemoved: #aa5555;
      --toolDiffContext: #6c6c6c;
      --syntaxComment: #008000;
      --syntaxKeyword: #0000ff;
      --syntaxFunction: #795e26;
      --syntaxVariable: #001080;
      --syntaxString: #a31515;
      --syntaxNumber: #098658;
      --syntaxType: #267f99;
      --syntaxOperator: #000000;
      --syntaxPunctuation: #000000;
      --thinkingOff: #b0b0b0;
      --thinkingMinimal: #767676;
      --thinkingLow: #547da7;
      --thinkingMedium: #5a8080;
      --thinkingHigh: #875f87;
      --thinkingXhigh: #8b008b;
      --thinkingMax: #af005f;
      --bashMode: #588458;
      --exportPageBg: #f8f8f8;
      --exportCardBg: #ffffff;
      --exportInfoBg: #fffae6;
      --body-bg: #f8f8f8;
      --container-bg: #ffffff;
      --info-bg: #fffae6;
      --hover: #d0d0e0;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --accent: #7dcfff;
        --border: #7aa2f7;
        --borderAccent: #7dcfff;
        --borderMuted: #3b4261;
        --success: #9ece6a;
        --error: #f7768e;
        --warning: #e0af68;
        --muted: #9aa5ce;
        --dim: #737aa2;
        --text: #c0caf5;
        --thinkingText: #9aa5ce;
        --selectedBg: #292e42;
        --scrollbarThumb: #3b4261;
        --searchMatchBg: #3b4261;
        --searchMatchText: #c0caf5;
        --userMessageBg: #292e42;
        --userMessageText: #c0caf5;
        --customMessageBg: #292e42;
        --customMessageText: #c0caf5;
        --customMessageLabel: #bb9af7;
        --toolPendingBg: #24283b;
        --toolSuccessBg: #20303b;
        --toolErrorBg: #3b2632;
        --toolTitle: #7dcfff;
        --toolOutput: #9aa5ce;
        --mdHeading: #e0af68;
        --mdLink: #7aa2f7;
        --mdLinkUrl: #737aa2;
        --mdCode: #7dcfff;
        --mdCodeBlock: #c0caf5;
        --mdCodeBlockBorder: #565f89;
        --mdQuote: #9aa5ce;
        --mdQuoteBorder: #565f89;
        --mdHr: #565f89;
        --mdListBullet: #9ece6a;
        --toolDiffAdded: #9ece6a;
        --toolDiffRemoved: #f7768e;
        --toolDiffContext: #9aa5ce;
        --syntaxComment: #565f89;
        --syntaxKeyword: #bb9af7;
        --syntaxFunction: #7dcfff;
        --syntaxVariable: #ff9e64;
        --syntaxString: #9ece6a;
        --syntaxNumber: #ff9e64;
        --syntaxType: #ff9e64;
        --syntaxOperator: #bb9af7;
        --syntaxPunctuation: #c0caf5;
        --thinkingOff: #3b4261;
        --thinkingMinimal: #565f89;
        --thinkingLow: #7aa2f7;
        --thinkingMedium: #7dcfff;
        --thinkingHigh: #bb9af7;
        --thinkingXhigh: #f7768e;
        --thinkingMax: #ff007c;
        --bashMode: #9ece6a;
        --exportPageBg: #1a1b26;
        --exportCardBg: #24283b;
        --exportInfoBg: #292e42;
        --body-bg: #1a1b26;
        --container-bg: #24283b;
        --info-bg: #292e42;
        --hover: #292e42;
      }
    }
`;

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
  patched = replaceUnique(
    patched,
    STYLE_END,
    `${SYSTEM_THEME_CSS}${STYLE_END}`,
    "viewer style block",
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
