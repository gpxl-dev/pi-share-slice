import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry, SessionHeader, Theme } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "./config.ts";
import { exportSlicedSessionToHtml, loadPiInternals, PiCompatibilityError, type PiInternalModules } from "./pi-internals.ts";
import { createSlicedSessionData, deriveShareRows, writeSlicedSessionJsonl } from "./slice.ts";
import { patchPiViewerFile } from "./viewer-patch.ts";

const header = {
  type: "session", version: 3, id: "HTML_OMIT_HEADER_ID", timestamp: "2026-01-01T00:00:00.000Z",
  cwd: "/home/private/HTML_OMIT_HEADER_CWD", parentSession: "/home/private/HTML_OMIT_PARENT_SESSION",
} as SessionHeader;
const usage = {
  input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const entries = [
  {
    type: "message", id: "keepuser", parentId: null, timestamp: "2026-01-01T00:00:01.000Z",
    message: { role: "user", content: "HTML_KEEP_USER", timestamp: 1, private: "HTML_OMIT_USER_METADATA" },
  },
  {
    type: "message", id: "omituser", parentId: "keepuser", timestamp: "2026-01-01T00:00:02.000Z",
    message: { role: "user", content: "HTML_OMIT_USER", timestamp: 2 },
  },
  {
    type: "message", id: "assistant", parentId: "omituser", timestamp: "2026-01-01T00:00:03.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "HTML_OMIT_REASONING" },
        { type: "text", text: "HTML_KEEP_ASSISTANT" },
        { type: "toolCall", id: "omit-call", name: "bash", arguments: { command: "HTML_OMIT_TOOL" } },
      ],
      api: "test", provider: "test", model: "test", usage, stopReason: "toolUse", timestamp: 3,
      diagnostics: [{ secret: "HTML_OMIT_DIAGNOSTICS" }], deferred: { id: "HTML_OMIT_DEFERRED" },
    },
  },
  {
    type: "message", id: "result", parentId: "assistant", timestamp: "2026-01-01T00:00:04.000Z",
    message: {
      role: "toolResult", toolCallId: "omit-call", toolName: "bash",
      content: [{ type: "text", text: "HTML_OMIT_RESULT" }], isError: false, timestamp: 4,
    },
  },
] as unknown as SessionEntry[];

function decodeEmbeddedSession(html: string): unknown {
  const match = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/);
  if (!match?.[1]) throw new Error("Pi HTML did not contain embedded session data");
  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as unknown;
}

describe("Pi internal compatibility adapter", () => {
  test("fails clearly when file-based internals are unavailable", async () => {
    await expect(loadPiInternals({
      packageDir: "/missing/pi",
      version: "9.9.9",
      exists: () => false,
      importer: async () => ({}),
    })).rejects.toThrow(PiCompatibilityError);
    await expect(loadPiInternals({
      packageDir: "/missing/pi",
      version: "9.9.9",
      exists: () => false,
      importer: async () => ({}),
    })).rejects.toThrow("will not fall back to Markdown");
  });

  test("uses the installed Pi exporter and embeds only selected content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "share-slice-html-"));
    try {
      const rows = deriveShareRows(entries, DEFAULT_CONFIG.defaults);
      const selected = new Set([
        rows.find((item) => item.entryId === "keepuser")!.id,
        rows.find((item) => item.category === "assistant")!.id,
      ]);
      const sliced = createSlicedSessionData(header, entries, rows, selected);
      const sessionPath = join(dir, "session.jsonl");
      const htmlPath = join(dir, "session.html");
      writeSlicedSessionJsonl(sessionPath, sliced);

      await exportSlicedSessionToHtml({
        sessionPath,
        outputPath: htmlPath,
        cwd: "/tmp",
        theme: { name: "dark" } as Theme,
        presentation: {},
      });
      patchPiViewerFile(htmlPath, {
        hideSidebar: true,
        hideHeaderToggles: true,
        condenseSummary: true,
      });
      const html = readFileSync(htmlPath, "utf8");
      const embedded = JSON.stringify(decodeEmbeddedSession(html));

      expect(html).toContain('<div id="sidebar-overlay"></div>');
      expect(html).toContain("--accent:");
      expect(html).toContain("color-scheme: light dark");
      expect(html).toContain("@media (prefers-color-scheme: dark)");
      expect(html).toContain("--body-bg: #1a1b26");
      expect(html).toContain("--syntaxKeyword: #bb9af7");
      expect(html).toContain('data-filter="user-assistant-only" data-pi-share-slice-patch="1"');
      expect(html).toContain("let filterMode = 'user-assistant-only';");
      expect(html).toContain("#sidebar, #sidebar-resizer, #hamburger, #sidebar-overlay { display: none !important; }");
      expect(html).not.toContain('class="header-toggle-btn"');
      expect(html).not.toContain("<h1>Session:");
      expect(html).toContain("Date:");
      expect(html).toContain("Models:");
      expect(html).not.toContain("Messages:");
      expect(embedded).toContain("HTML_KEEP_USER");
      expect(embedded).toContain("HTML_KEEP_ASSISTANT");
      expect(embedded).not.toContain("HTML_OMIT_USER");
      expect(embedded).not.toContain("HTML_OMIT_REASONING");
      expect(embedded).not.toContain("HTML_OMIT_TOOL");
      expect(embedded).not.toContain("HTML_OMIT_RESULT");
      expect(embedded).not.toContain("HTML_OMIT_HEADER_ID");
      expect(embedded).not.toContain("HTML_OMIT_HEADER_CWD");
      expect(embedded).not.toContain("HTML_OMIT_PARENT_SESSION");
      expect(embedded).not.toContain("HTML_OMIT_USER_METADATA");
      expect(embedded).not.toContain("HTML_OMIT_DIAGNOSTICS");
      expect(embedded).not.toContain("HTML_OMIT_DEFERRED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("forwards presentation, theme, cwd, and built-in renderer through the production adapter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "share-slice-forwarding-"));
    try {
      const rows = deriveShareRows(entries, DEFAULT_CONFIG.defaults);
      const sliced = createSlicedSessionData(header, entries, rows, new Set([rows[0]!.id]));
      const sessionPath = join(dir, "session.jsonl");
      const outputPath = join(dir, "session.html");
      writeSlicedSessionJsonl(sessionPath, sliced);

      const renderer = { renderer: true };
      const presentation = { systemPrompt: "SYSTEM", tools: [] };
      const theme = { name: "light" } as Theme;
      let captured: { state?: unknown; options?: Record<string, unknown>; cwd?: string; theme?: Theme } = {};
      const internals = {
        buildSystemPrompt: () => "unused",
        createAllToolDefinitions: (cwd: string) => {
          captured.cwd = cwd;
          return { read: { name: "read" } };
        },
        createToolHtmlRenderer: (options: { cwd: string; theme: Theme; getToolDefinition: (name: string) => unknown }) => {
          captured.theme = options.theme;
          expect(options.getToolDefinition("read")).toEqual({ name: "read" });
          return renderer;
        },
        exportSessionToHtml: async (_manager: unknown, state: unknown, options: Record<string, unknown>) => {
          captured = { ...captured, state, options };
          return outputPath;
        },
      } as PiInternalModules;

      await exportSlicedSessionToHtml({
        sessionPath, outputPath, cwd: "/forwarded/cwd", theme, presentation, internals,
      });
      expect(captured.cwd).toBe("/forwarded/cwd");
      expect(captured.theme).toBe(theme);
      expect(captured.state).toBe(presentation);
      expect(captured.options).toEqual({ outputPath, themeName: "light", toolRenderer: renderer });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
