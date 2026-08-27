import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type SessionEntry, type SessionHeader } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "./config.ts";
import { createSlicedSessionData, deriveShareRows, writeSlicedSessionJsonl } from "./slice.ts";

const usage = {
  input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const header = {
  type: "session", version: 3, id: "fixture-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp",
} as SessionHeader;

const entries = [
  {
    type: "message", id: "user0001", parentId: null, timestamp: "2026-01-01T00:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text: "KEEP user" }], timestamp: 1 },
  },
  {
    type: "message", id: "assist01", parentId: "user0001", timestamp: "2026-01-01T00:00:02.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "SECRET reasoning" },
        { type: "text", text: "KEEP assistant" },
        { type: "toolCall", id: "call-one", name: "read", arguments: { path: "one.txt" } },
        { type: "toolCall", id: "call-two", name: "bash", arguments: { command: "SECRET command" } },
      ],
      api: "test", provider: "test", model: "test", usage, stopReason: "toolUse", timestamp: 2,
    },
  },
  {
    type: "message", id: "result01", parentId: "assist01", timestamp: "2026-01-01T00:00:03.000Z",
    message: {
      role: "toolResult", toolCallId: "call-one", toolName: "read",
      content: [{ type: "text", text: "RESULT one" }], isError: false, timestamp: 3,
    },
  },
  {
    type: "message", id: "result02", parentId: "result01", timestamp: "2026-01-01T00:00:04.000Z",
    message: {
      role: "toolResult", toolCallId: "call-two", toolName: "bash",
      content: [{ type: "text", text: "SECRET result two" }], isError: false, timestamp: 4,
    },
  },
] as unknown as SessionEntry[];

describe("active branch row derivation and reconstruction", () => {
  test("derives independent assistant, reasoning, and bundled tool rows", () => {
    const rows = deriveShareRows(entries, DEFAULT_CONFIG.defaults);
    expect(rows.map((item) => item.category)).toEqual(["user", "assistant", "reasoning", "tool", "tool"]);
    expect(rows.filter((item) => item.initiallySelected).map((item) => item.category)).toEqual(["user", "assistant"]);
    const tools = rows.filter((item) => item.category === "tool");
    expect(tools[0]?.searchableText).toContain("RESULT one");
    expect(tools[1]?.searchableText).toContain("SECRET result two");
  });

  test("default selection removes reasoning, calls, and results", () => {
    const rows = deriveShareRows(entries, DEFAULT_CONFIG.defaults);
    const selected = new Set(rows.filter((item) => item.initiallySelected).map((item) => item.id));
    const sliced = createSlicedSessionData(header, entries, rows, selected);
    const serialized = JSON.stringify(sliced.entries);
    expect(serialized).toContain("KEEP user");
    expect(serialized).toContain("KEEP assistant");
    expect(serialized).not.toContain("SECRET reasoning");
    expect(serialized).not.toContain("call-one");
    expect(serialized).not.toContain("RESULT one");
    expect(sliced.entries.map((entry) => entry.parentId)).toEqual([null, "user0001"]);
  });

  test("rebuilds selected entries from explicit privacy-safe fields", () => {
    const privateEntries = [
      {
        type: "message", id: "private-user", parentId: null, timestamp: "2026-01-01T00:00:01.000Z",
        entryPrivate: "OMIT_ENTRY_PRIVATE",
        message: {
          role: "user", content: [
            { type: "text", text: "VISIBLE_USER", hidden: "OMIT_USER_BLOCK" },
            { type: "image", data: "VISIBLE_IMAGE", mimeType: { secret: "OMIT_MALFORMED_MIME_TYPE" } },
          ],
          timestamp: 1, privateUser: "OMIT_USER_PRIVATE",
        },
      },
      {
        type: "message", id: "private-assistant", parentId: "private-user", timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "VISIBLE_THINKING", signature: "OMIT_THINKING_SIGNATURE" },
            { type: "text", text: "VISIBLE_ASSISTANT", hidden: "OMIT_ASSISTANT_BLOCK" },
            { type: "toolCall", id: "edit-call", name: "edit", arguments: { path: "visible.txt" }, private: "OMIT_CALL_PRIVATE" },
            { type: "toolCall", id: "malformed-name-call", name: { secret: "OMIT_MALFORMED_TOOL_NAME" }, arguments: {} },
          ],
          api: { secret: "OMIT_MALFORMED_API" }, provider: "test", model: "test",
          usage: {
            ...usage,
            input: { secret: "OMIT_MALFORMED_USAGE_INPUT" },
            cost: { ...usage.cost, total: { secret: "OMIT_MALFORMED_COST_TOTAL" } },
            private: "OMIT_USAGE_PRIVATE",
          },
          stopReason: "toolUse", errorMessage: "VISIBLE_ERROR", timestamp: { secret: "OMIT_MALFORMED_TIMESTAMP" },
          diagnostics: [{ secret: "OMIT_DIAGNOSTIC" }], deferred: { id: "OMIT_DEFERRED" },
          responseId: "OMIT_RESPONSE_ID", rawStopReason: "OMIT_RAW_STOP", endTurn: true,
        },
      },
      {
        type: "message", id: "private-result", parentId: "private-assistant", timestamp: "2026-01-01T00:00:03.000Z",
        message: {
          role: "toolResult", toolCallId: "edit-call", toolName: "edit",
          content: [{ type: "text", text: "VISIBLE_RESULT", hidden: "OMIT_RESULT_BLOCK" }],
          details: { diff: "VISIBLE_EDIT_DIFF", secret: "OMIT_RESULT_DETAILS" },
          usage: { private: "OMIT_RESULT_USAGE" }, addedToolNames: ["OMIT_ADDED_TOOLS"],
          isError: false, timestamp: 3, private: "OMIT_RESULT_PRIVATE",
        },
      },
      {
        type: "message", id: "private-bash", parentId: "private-result", timestamp: "2026-01-01T00:00:04.000Z",
        message: {
          role: "bashExecution", command: "VISIBLE_COMMAND", output: "VISIBLE_OUTPUT", exitCode: 0,
          cancelled: false, truncated: true, fullOutputPath: "/home/private/OMIT_FULL_OUTPUT_PATH",
          excludeFromContext: true, private: "OMIT_BASH_PRIVATE", timestamp: 4,
        },
      },
      {
        type: "custom_message", id: "custom-message", parentId: "private-bash", timestamp: "2026-01-01T00:00:05.000Z",
        customType: "visible-custom", content: "VISIBLE_CUSTOM", display: true,
        details: { secret: "OMIT_CUSTOM_DETAILS" }, private: "OMIT_CUSTOM_PRIVATE",
      },
      {
        type: "compaction", id: "compact", parentId: "custom-message", timestamp: "2026-01-01T00:00:06.000Z",
        summary: "VISIBLE_COMPACTION", firstKeptEntryId: "OMIT_FIRST_KEPT", tokensBefore: 50,
        details: { secret: "OMIT_COMPACTION_DETAILS" }, usage: { private: "OMIT_COMPACTION_USAGE" },
        retainedTail: "OMIT_RETAINED_TAIL", fromHook: true,
      },
      {
        type: "branch_summary", id: "branch-summary", parentId: "compact", timestamp: "2026-01-01T00:00:07.000Z",
        fromId: "OMIT_BRANCH_FROM", summary: "VISIBLE_BRANCH_SUMMARY",
        details: { secret: "OMIT_BRANCH_DETAILS" }, usage: { private: "OMIT_BRANCH_USAGE" }, fromHook: true,
      },
      {
        type: "custom", id: "custom-persistence", parentId: "branch-summary", timestamp: "2026-01-01T00:00:08.000Z",
        customType: "hidden-state", data: { secret: "OMIT_CUSTOM_PERSISTENCE" },
      },
      {
        type: "model_change", id: "model-change", parentId: "custom-persistence", timestamp: "2026-01-01T00:00:09.000Z",
        provider: "visible-provider", modelId: "visible-model", private: "OMIT_MODEL_PRIVATE",
      },
      {
        type: "thinking_level_change", id: "thinking-change", parentId: "model-change", timestamp: "2026-01-01T00:00:10.000Z",
        thinkingLevel: "high", private: "OMIT_THINKING_SETTING_PRIVATE",
      },
      {
        type: "session_info", id: "session-info", parentId: "thinking-change", timestamp: "2026-01-01T00:00:11.000Z",
        name: "VISIBLE_TITLE", private: "OMIT_SESSION_INFO_PRIVATE",
      },
    ] as unknown as SessionEntry[];
    const privateHeader = {
      type: "session", version: 2, id: "OMIT_ORIGINAL_HEADER_ID", timestamp: "2020-01-01T00:00:00.000Z",
      cwd: "/home/private/OMIT_HEADER_CWD", parentSession: "/home/private/OMIT_PARENT_SESSION",
      private: "OMIT_HEADER_PRIVATE",
    } as unknown as SessionHeader;
    const rows = deriveShareRows(privateEntries, DEFAULT_CONFIG.defaults);
    expect(rows.some((item) => item.entryId === "custom-persistence")).toBeFalse();
    const sliced = createSlicedSessionData(privateHeader, privateEntries, rows, new Set(rows.map((item) => item.id)));
    const serialized = JSON.stringify(sliced);

    for (const marker of [
      "OMIT_ENTRY_PRIVATE", "OMIT_USER_BLOCK", "OMIT_USER_PRIVATE", "OMIT_THINKING_SIGNATURE",
      "OMIT_ASSISTANT_BLOCK", "OMIT_CALL_PRIVATE", "OMIT_MALFORMED_MIME_TYPE", "OMIT_MALFORMED_TOOL_NAME",
      "OMIT_USAGE_PRIVATE", "OMIT_MALFORMED_API",
      "OMIT_MALFORMED_USAGE_INPUT", "OMIT_MALFORMED_COST_TOTAL", "OMIT_MALFORMED_TIMESTAMP",
      "OMIT_DIAGNOSTIC", "OMIT_DEFERRED",
      "OMIT_RESPONSE_ID", "OMIT_RAW_STOP", "OMIT_RESULT_BLOCK", "OMIT_RESULT_DETAILS", "OMIT_RESULT_USAGE",
      "OMIT_ADDED_TOOLS", "OMIT_RESULT_PRIVATE", "OMIT_FULL_OUTPUT_PATH", "OMIT_BASH_PRIVATE",
      "OMIT_CUSTOM_DETAILS", "OMIT_CUSTOM_PRIVATE", "OMIT_FIRST_KEPT", "OMIT_COMPACTION_DETAILS",
      "OMIT_COMPACTION_USAGE", "OMIT_RETAINED_TAIL", "OMIT_BRANCH_FROM", "OMIT_BRANCH_DETAILS",
      "OMIT_BRANCH_USAGE", "OMIT_CUSTOM_PERSISTENCE", "OMIT_MODEL_PRIVATE", "OMIT_THINKING_SETTING_PRIVATE",
      "OMIT_SESSION_INFO_PRIVATE", "OMIT_ORIGINAL_HEADER_ID", "OMIT_HEADER_CWD", "OMIT_PARENT_SESSION",
      "OMIT_HEADER_PRIVATE",
    ]) expect(serialized).not.toContain(marker);
    for (const marker of [
      "VISIBLE_USER", "VISIBLE_IMAGE", "VISIBLE_THINKING", "VISIBLE_ASSISTANT", "VISIBLE_EDIT_DIFF", "VISIBLE_RESULT",
      "VISIBLE_COMMAND", "VISIBLE_OUTPUT", "VISIBLE_CUSTOM", "VISIBLE_COMPACTION", "VISIBLE_BRANCH_SUMMARY",
      "VISIBLE_TITLE",
    ]) expect(serialized).toContain(marker);
    expect(sliced.header).toEqual({
      type: "session", version: 3, id: expect.any(String), timestamp: expect.any(String), cwd: ".",
    });
    expect(sliced.header.id).not.toBe(privateHeader.id);
    expect((sliced.entries.find((entry) => entry.type === "compaction") as { tokensBefore: number }).tokensBefore).toBe(50);
  });

  test("fails closed on missing or duplicate session identifiers", () => {
    const duplicateEntry = [...entries, { ...entries[0] }] as SessionEntry[];
    expect(() => deriveShareRows(duplicateEntry, DEFAULT_CONFIG.defaults)).toThrow("duplicate entry ID");

    const duplicateToolCalls = [{
      type: "message", id: "assistant-only", parentId: null, timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "duplicate-call", name: "read", arguments: {} },
          { type: "toolCall", id: "duplicate-call", name: "bash", arguments: {} },
        ],
        timestamp: 1,
      },
    }] as unknown as SessionEntry[];
    expect(() => deriveShareRows(duplicateToolCalls, DEFAULT_CONFIG.defaults)).toThrow("duplicate tool-call ID");

    const missingResultId = [{
      type: "message", id: "result-only", parentId: null, timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "toolResult", toolName: "read", content: [], isError: false, timestamp: 1 },
    }] as unknown as SessionEntry[];
    expect(() => deriveShareRows(missingResultId, DEFAULT_CONFIG.defaults)).toThrow("missing tool-call ID");

    const rows = deriveShareRows(entries, DEFAULT_CONFIG.defaults);
    expect(() => createSlicedSessionData(header, duplicateEntry, rows, new Set(rows.map((item) => item.id)))).toThrow(
      "duplicate entry ID",
    );
  });

  test("selecting one tool includes only its call and paired result in valid JSONL", () => {
    const rows = deriveShareRows(entries, DEFAULT_CONFIG.defaults);
    const selected = new Set([
      rows.find((item) => item.category === "assistant")!.id,
      rows.find((item) => item.toolCallId === "call-one")!.id,
    ]);
    const sliced = createSlicedSessionData(header, entries, rows, selected);
    const serialized = JSON.stringify(sliced.entries);
    expect(serialized).toContain("call-one");
    expect(serialized).toContain("RESULT one");
    expect(serialized).not.toContain("call-two");
    expect(serialized).not.toContain("SECRET result two");

    const dir = mkdtempSync(join(tmpdir(), "share-slice-session-"));
    try {
      const path = join(dir, "slice.jsonl");
      writeSlicedSessionJsonl(path, sliced);
      const jsonl = readFileSync(path, "utf8");
      expect(jsonl).not.toContain("fixture-session");
      expect(jsonl).not.toContain('"cwd":"/tmp"');
      const opened = SessionManager.open(path);
      expect(opened.getEntries()).toHaveLength(2);
      expect(opened.getLeafId()).toBe("result01");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
