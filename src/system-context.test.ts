import { describe, expect, test } from "bun:test";
import type { BuildSystemPromptOptions, ToolInfo } from "@earendil-works/pi-coding-agent";
import { loadPiInternals, type PiInternalModules } from "./pi-internals.ts";
import { buildPresentationState } from "./system-context.ts";

const baseOptions: BuildSystemPromptOptions = {
  cwd: "/tmp/project",
  selectedTools: ["read", "bash"],
  toolSnippets: { read: "Read files", bash: "Run commands" },
  promptGuidelines: ["Use read carefully", "Use bash carefully"],
  contextFiles: [{ path: "/tmp/project/AGENTS.md", content: "Keep this context" }],
};

const context = {
  getSystemPrompt: () => "FULL SYSTEM WITH TOOLS",
  getSystemPromptOptions: () => baseOptions,
};
const toolList = [
  { name: "read", description: "Read", parameters: {} },
  { name: "bash", description: "Bash", parameters: {} },
] as ToolInfo[];
const tools = { getActiveTools: () => ["read"], getAllTools: () => toolList };

describe("system context presentation", () => {
  test("none omits prompt and definitions", async () => {
    expect(await buildPresentationState("none", context, tools)).toEqual({});
  });

  test("without-tools rebuilds from structured options with tool metadata empty", async () => {
    let captured: BuildSystemPromptOptions | undefined;
    const internals = {
      buildSystemPrompt: (options: BuildSystemPromptOptions) => {
        captured = options;
        return "SYSTEM WITHOUT TOOLS";
      },
      exportSessionToHtml: async () => "unused",
    } as PiInternalModules;
    const result = await buildPresentationState("without-tools", context, tools, internals);
    expect(result).toEqual({ systemPrompt: "SYSTEM WITHOUT TOOLS" });
    expect(captured?.selectedTools).toEqual([]);
    expect(captured?.toolSnippets).toEqual({});
    expect(captured?.promptGuidelines).toEqual([]);
    expect(captured?.contextFiles).toEqual(baseOptions.contextFiles);
  });

  test("installed builder produces a no-tools prompt without snippets or tool guidelines", async () => {
    const result = await buildPresentationState("without-tools", context, tools, await loadPiInternals());
    expect(result.systemPrompt).toContain("Available tools:\n(none)");
    expect(result.systemPrompt).not.toContain("Read files");
    expect(result.systemPrompt).not.toContain("Use read carefully");
    expect(result.systemPrompt).toContain("Keep this context");
  });

  test("with-tools keeps the effective prompt and active definitions only", async () => {
    const result = await buildPresentationState("with-tools", context, tools);
    expect(result.systemPrompt).toBe("FULL SYSTEM WITH TOOLS");
    expect(result.tools?.map((tool) => tool.name)).toEqual(["read"]);
  });
});
