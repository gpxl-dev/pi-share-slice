import type { BuildSystemPromptOptions, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { SystemMode } from "./config.ts";
import { loadPiInternals, type HtmlPresentationState, type PiInternalModules } from "./pi-internals.ts";

export interface SystemContextSource {
  getSystemPrompt(): string;
  getSystemPromptOptions(): BuildSystemPromptOptions;
}

export interface ToolContextSource {
  getActiveTools(): string[];
  getAllTools(): ToolInfo[];
}

export async function buildPresentationState(
  mode: SystemMode,
  context: SystemContextSource,
  tools: ToolContextSource,
  internals?: PiInternalModules,
): Promise<HtmlPresentationState> {
  if (mode === "none") return {};

  if (mode === "without-tools") {
    const loaded = internals ?? await loadPiInternals();
    const options = context.getSystemPromptOptions();
    return {
      systemPrompt: loaded.buildSystemPrompt({
        ...options,
        selectedTools: [],
        toolSnippets: {},
        promptGuidelines: [],
      }),
    };
  }

  const active = new Set(tools.getActiveTools());
  return {
    systemPrompt: context.getSystemPrompt(),
    tools: tools.getAllTools()
      .filter((tool) => active.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
  };
}
