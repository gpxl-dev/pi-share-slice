import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const SYSTEM_MODES = ["none", "without-tools", "with-tools"] as const;
export type SystemMode = (typeof SYSTEM_MODES)[number];

export const FILTER_MODES = ["user-assistant-only", "default", "no-tools", "user-only", "labeled-only", "all"] as const;
export type FilterMode = (typeof FILTER_MODES)[number];

export const ROW_CATEGORIES = ["user", "assistant", "reasoning", "tool", "context"] as const;
export type RowCategory = (typeof ROW_CATEGORIES)[number];

export interface ShareSliceDefaults {
  user: boolean;
  assistant: boolean;
  reasoning: boolean;
  tool: boolean;
  context: boolean;
  patchViewer: boolean;
  systemContext: SystemMode;
  filterMode: FilterMode;
}

export interface ShareSliceConfig {
  defaults: ShareSliceDefaults;
}

export const DEFAULT_CONFIG: ShareSliceConfig = {
  defaults: {
    user: true,
    assistant: true,
    reasoning: false,
    tool: false,
    context: false,
    patchViewer: true,
    systemContext: "none",
    filterMode: "user-assistant-only",
  },
};

export interface LoadedConfig {
  config: ShareSliceConfig;
  path: string;
  warnings: string[];
}

export function getConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-share-slice.json");
}

function cloneDefaults(): ShareSliceDefaults {
  return { ...DEFAULT_CONFIG.defaults };
}

export function parseConfig(value: unknown): { config: ShareSliceConfig; warnings: string[] } {
  const warnings: string[] = [];
  const defaults = cloneDefaults();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { config: { defaults }, warnings: ["Configuration root must be an object; using defaults."] };
  }

  const rawDefaults = (value as { defaults?: unknown }).defaults;
  if (rawDefaults === undefined) return { config: { defaults }, warnings };
  if (!rawDefaults || typeof rawDefaults !== "object" || Array.isArray(rawDefaults)) {
    return { config: { defaults }, warnings: ["defaults must be an object; using defaults."] };
  }

  const record = rawDefaults as Record<string, unknown>;
  for (const category of ROW_CATEGORIES) {
    const raw = record[category];
    if (raw === undefined) continue;
    if (typeof raw === "boolean") defaults[category] = raw;
    else warnings.push(`defaults.${category} must be true or false; using ${String(defaults[category])}.`);
  }

  const patchViewer = record.patchViewer;
  if (patchViewer !== undefined) {
    if (typeof patchViewer === "boolean") defaults.patchViewer = patchViewer;
    else warnings.push(`defaults.patchViewer must be true or false; using ${String(defaults.patchViewer)}.`);
  }

  const systemContext = record.systemContext;
  if (systemContext !== undefined) {
    if (typeof systemContext === "string" && (SYSTEM_MODES as readonly string[]).includes(systemContext)) {
      defaults.systemContext = systemContext as SystemMode;
    } else {
      warnings.push(`defaults.systemContext must be one of: ${SYSTEM_MODES.join(", ")}; using ${defaults.systemContext}.`);
    }
  }

  const filterMode = record.filterMode;
  if (filterMode !== undefined) {
    if (typeof filterMode === "string" && (FILTER_MODES as readonly string[]).includes(filterMode)) {
      defaults.filterMode = filterMode as FilterMode;
    } else {
      warnings.push(`defaults.filterMode must be one of: ${FILTER_MODES.join(", ")}; using ${defaults.filterMode}.`);
    }
  }

  return { config: { defaults }, warnings };
}

export function loadConfig(options: { agentDir?: string; readFile?: typeof readFileSync } = {}): LoadedConfig {
  const path = getConfigPath(options.agentDir);
  const readFile = options.readFile ?? readFileSync;
  try {
    const parsed = JSON.parse(readFile(path, "utf8")) as unknown;
    return { ...parseConfig(parsed), path };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { config: { defaults: cloneDefaults() }, path, warnings: [] };
    const message = error instanceof SyntaxError ? "Invalid JSON" : error instanceof Error ? error.message : String(error);
    return {
      config: { defaults: cloneDefaults() },
      path,
      warnings: [`Could not load ${path}: ${message}; using defaults.`],
    };
  }
}

export function saveConfig(config: ShareSliceConfig, options: { agentDir?: string } = {}): string {
  const path = getConfigPath(options.agentDir);
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
  return path;
}
