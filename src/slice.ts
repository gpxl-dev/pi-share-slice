import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  CURRENT_SESSION_VERSION,
  type SessionEntry,
  type SessionHeader,
  type SessionTreeNode,
} from "@earendil-works/pi-coding-agent";
import type { RowCategory, ShareSliceDefaults } from "./config.ts";

type ContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  data?: string;
  mimeType?: string;
};

type MessageLike = {
  role?: string;
  content?: unknown;
  command?: string;
  output?: string;
  exitCode?: number;
  cancelled?: boolean;
  truncated?: boolean;
  errorMessage?: string;
  toolCallId?: string;
  toolName?: string;
  customType?: string;
  display?: boolean;
  summary?: string;
  fromId?: string;
  tokensBefore?: number;
  timestamp?: number;
  [key: string]: unknown;
};

type UnknownRecord = Record<string, unknown>;

export interface ShareRow {
  id: string;
  category: RowCategory;
  entryId: string;
  toolCallId?: string;
  label?: string;
  preview: string;
  searchableText: string;
  initiallySelected: boolean;
  toolLike: boolean;
  defaultVisible: boolean;
}

export interface SlicedSessionData {
  header: SessionHeader;
  entries: SessionEntry[];
  leafId: string | null;
}

function asMessage(entry: SessionEntry): MessageLike | undefined {
  return entry.type === "message" ? (entry.message as MessageLike) : undefined;
}

function blocks(content: unknown): ContentBlock[] {
  return Array.isArray(content) ? (content.filter((item) => item && typeof item === "object") as ContentBlock[]) : [];
}

function textFromContent(content: unknown, types: readonly string[] = ["text"]): string {
  if (typeof content === "string") return content;
  return blocks(content)
    .filter((block) => block.type && types.includes(block.type))
    .map((block) => block.type === "thinking" ? block.thinking ?? "" : block.text ?? "")
    .filter(Boolean)
    .join("\n");
}

function normalizePreview(value: string, fallback: string): string {
  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function contentSearchText(content: unknown): string {
  if (typeof content === "string") return content;
  return blocks(content)
    .map((block) => {
      if (block.type === "thinking") return block.thinking ?? "";
      if (block.type === "toolCall") return `${block.name ?? "tool"} ${JSON.stringify(block.arguments ?? {})}`;
      if (block.type === "image") return `[image ${block.mimeType ?? ""}]`;
      return block.text ?? "";
    })
    .join("\n");
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function safeEntryTimestamp(value: unknown): string {
  return typeof value === "string" ? value : new Date().toISOString();
}

function safeMessageTimestamp(value: unknown, entryTimestamp: unknown): number {
  const direct = safeNumber(value);
  if (direct !== undefined) return direct;
  const parsed = typeof entryTimestamp === "string" ? Date.parse(entryTimestamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function assertUniqueSessionIdentifiers(entries: readonly SessionEntry[]): void {
  const entryIds = new Set<string>();
  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();

  for (const entry of entries) {
    const entryId = safeString((entry as { id?: unknown }).id);
    if (!entryId?.trim()) throw new Error("Cannot share a session entry with a missing ID.");
    if (entryIds.has(entryId)) throw new Error(`Cannot share a session with duplicate entry ID: ${entryId}`);
    entryIds.add(entryId);

    const message = asMessage(entry);
    if (message?.role === "assistant") {
      for (const block of blocks(message.content)) {
        if (block.type !== "toolCall") continue;
        const toolCallId = safeString(block.id);
        if (!toolCallId?.trim()) throw new Error(`Cannot share tool call in entry ${entryId}: missing tool-call ID.`);
        if (toolCallIds.has(toolCallId)) throw new Error(`Cannot share a session with duplicate tool-call ID: ${toolCallId}`);
        toolCallIds.add(toolCallId);
      }
    } else if (message?.role === "toolResult") {
      const toolCallId = safeString(message.toolCallId);
      if (!toolCallId?.trim()) throw new Error(`Cannot share tool result in entry ${entryId}: missing tool-call ID.`);
      if (toolResultIds.has(toolCallId)) throw new Error(`Cannot share duplicate results for tool-call ID: ${toolCallId}`);
      toolResultIds.add(toolCallId);
    }
  }
}

export function collectLabels(tree: readonly SessionTreeNode[]): Map<string, string> {
  const labels = new Map<string, string>();
  const stack = [...tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.label) labels.set(node.entry.id, node.label);
    stack.push(...node.children);
  }
  return labels;
}

function row(
  input: Omit<ShareRow, "initiallySelected" | "toolLike" | "defaultVisible"> & {
    defaults: ShareSliceDefaults;
    toolLike?: boolean;
    defaultVisible?: boolean;
  },
): ShareRow {
  return {
    id: input.id,
    category: input.category,
    entryId: input.entryId,
    toolCallId: input.toolCallId,
    label: input.label,
    preview: input.preview,
    searchableText: input.searchableText,
    initiallySelected: input.defaults[input.category],
    toolLike: input.toolLike ?? input.category === "tool",
    defaultVisible: input.defaultVisible ?? true,
  };
}

export function deriveShareRows(
  entries: readonly SessionEntry[],
  defaults: ShareSliceDefaults,
  labels: ReadonlyMap<string, string> = new Map(),
): ShareRow[] {
  assertUniqueSessionIdentifiers(entries);
  const rows: ShareRow[] = [];
  const resultByCall = new Map<string, { entry: SessionEntry; message: MessageLike }>();
  const representedResults = new Set<string>();

  for (const entry of entries) {
    const message = asMessage(entry);
    if (message?.role === "toolResult" && message.toolCallId) {
      resultByCall.set(message.toolCallId, { entry, message });
    }
  }

  for (const entry of entries) {
    const label = labels.get(entry.id);
    const message = asMessage(entry);
    if (message) {
      if (message.role === "user") {
        const text = contentSearchText(message.content);
        rows.push(row({
          id: `${entry.id}:user`, category: "user", entryId: entry.id, label,
          preview: normalizePreview(text, "[image or empty user message]"),
          searchableText: `user ${label ?? ""} ${text}`, defaults,
        }));
        continue;
      }

      if (message.role === "assistant") {
        const assistantBlocks = blocks(message.content);
        const text = textFromContent(message.content, ["text"]);
        if (text.trim() || message.errorMessage) {
          rows.push(row({
            id: `${entry.id}:assistant`, category: "assistant", entryId: entry.id, label,
            preview: normalizePreview(text || message.errorMessage || "", "(no assistant text)"),
            searchableText: `assistant ${label ?? ""} ${text} ${message.errorMessage ?? ""}`, defaults,
          }));
        }

        const reasoning = textFromContent(message.content, ["thinking"]);
        if (reasoning.trim()) {
          rows.push(row({
            id: `${entry.id}:reasoning`, category: "reasoning", entryId: entry.id, label,
            preview: normalizePreview(reasoning, "(empty reasoning)"),
            searchableText: `reasoning thinking ${label ?? ""} ${reasoning}`, defaults,
          }));
        }

        for (const block of assistantBlocks) {
          if (block.type !== "toolCall" || !block.id) continue;
          const result = resultByCall.get(block.id);
          if (result) representedResults.add(result.entry.id);
          const resultText = result ? contentSearchText(result.message.content) : "";
          const resultDetails = result ? record(result.message.details) : undefined;
          const visibleEditDiff = block.name === "edit" && typeof resultDetails?.diff === "string"
            ? resultDetails.diff
            : "";
          const toolText = `${block.name ?? "tool"} ${JSON.stringify(block.arguments ?? {})}`;
          rows.push(row({
            id: `${entry.id}:tool:${block.id}`, category: "tool", entryId: entry.id,
            toolCallId: block.id, label: label ?? (result ? labels.get(result.entry.id) : undefined),
            preview: normalizePreview(`${block.name ?? "tool"}: ${JSON.stringify(block.arguments ?? {})}`, "tool"),
            searchableText: `tool ${label ?? ""} ${toolText} ${resultText} ${visibleEditDiff}`, defaults, toolLike: true,
          }));
        }
        continue;
      }

      if (message.role === "toolResult") {
        if (representedResults.has(entry.id)) continue;
        const text = contentSearchText(message.content);
        rows.push(row({
          id: `${entry.id}:orphan-tool`, category: "tool", entryId: entry.id,
          toolCallId: message.toolCallId, label,
          preview: normalizePreview(`${message.toolName ?? "tool"}: ${text}`, "orphan tool result"),
          searchableText: `tool result ${message.toolName ?? ""} ${label ?? ""} ${text}`,
          defaults, toolLike: true,
        }));
        continue;
      }

      if (message.role === "bashExecution") {
        const text = `${message.command ?? ""}\n${message.output ?? ""}`;
        rows.push(row({
          id: `${entry.id}:bash`, category: "tool", entryId: entry.id, label,
          preview: normalizePreview(message.command ?? "", "bash execution"),
          searchableText: `bash ${label ?? ""} ${text}`, defaults, toolLike: true,
        }));
        continue;
      }

      if (message.role === "custom" && message.display === false) continue;
      const text = message.role === "branchSummary" || message.role === "compactionSummary"
        ? message.summary ?? ""
        : contentSearchText(message.content);
      rows.push(row({
        id: `${entry.id}:context`, category: "context", entryId: entry.id, label,
        preview: normalizePreview(text, `[${message.role ?? "message"}]`),
        searchableText: `${message.role ?? "message"} ${label ?? ""} ${text}`, defaults,
      }));
      continue;
    }

    let preview = `[${entry.type}]`;
    let search = entry.type;
    if (entry.type === "custom") continue;
    if (entry.type === "custom_message") {
      if (!entry.display) continue;
      const text = contentSearchText(entry.content);
      preview = normalizePreview(text, `[${entry.customType}]`);
      search += ` ${entry.customType} ${text}`;
    } else if (entry.type === "compaction") {
      preview = normalizePreview(entry.summary, "compaction summary");
      search += ` ${entry.summary}`;
    } else if (entry.type === "branch_summary") {
      preview = normalizePreview(entry.summary, "branch summary");
      search += ` ${entry.summary}`;
    } else if (entry.type === "model_change") {
      preview = `model: ${entry.modelId}`;
      search += ` ${entry.modelId}`;
    } else if (entry.type === "thinking_level_change") {
      preview = `thinking: ${entry.thinkingLevel}`;
      search += ` ${entry.thinkingLevel}`;
    } else if (entry.type === "session_info") {
      preview = `title: ${entry.name ?? "(empty)"}`;
      search += ` ${entry.name ?? ""}`;
    }
    const defaultVisible = entry.type === "custom_message" || entry.type === "compaction" || entry.type === "branch_summary";
    rows.push(row({
      id: `${entry.id}:context`, category: "context", entryId: entry.id, label,
      preview, searchableText: `context ${label ?? ""} ${search}`, defaults, defaultVisible,
    }));
  }

  return rows;
}

function selectedRowsByEntry(rows: readonly ShareRow[], selectedIds: ReadonlySet<string>): Map<string, ShareRow[]> {
  const result = new Map<string, ShareRow[]>();
  for (const item of rows) {
    if (!selectedIds.has(item.id)) continue;
    const existing = result.get(item.entryId) ?? [];
    existing.push(item);
    result.set(item.entryId, existing);
  }
  return result;
}

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function safeContent(content: unknown): unknown {
  if (typeof content === "string") return content;
  return blocks(content).flatMap<ContentBlock>((block) => {
    if (block.type === "text" && typeof block.text === "string") return [{ type: "text", text: block.text }];
    if (block.type === "image" && typeof block.data === "string") {
      return [{ type: "image", data: block.data, mimeType: safeString(block.mimeType) ?? "image/png" }];
    }
    return [];
  });
}

function safeAssistantContent(
  content: unknown,
  includeText: boolean,
  includeReasoning: boolean,
  selectedCalls: ReadonlySet<string | undefined>,
): ContentBlock[] {
  return blocks(content).flatMap<ContentBlock>((block) => {
    if (block.type === "text" && includeText && typeof block.text === "string") {
      return [{ type: "text", text: block.text }];
    }
    if (block.type === "thinking" && includeReasoning && typeof block.thinking === "string") {
      return [{ type: "thinking", thinking: block.thinking }];
    }
    if (block.type === "toolCall" && block.id && selectedCalls.has(block.id)) {
      return [{
        type: "toolCall",
        id: block.id,
        name: safeString(block.name) ?? "tool",
        arguments: block.arguments ?? {},
      }];
    }
    return [];
  });
}

function safeUsage(value: unknown): unknown {
  const usage = record(value);
  if (!usage) return undefined;
  const result: UnknownRecord = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
    const number = safeNumber(usage[key]);
    if (number !== undefined) result[key] = number;
  }
  const cost = record(usage.cost);
  if (cost) {
    const safeCost: UnknownRecord = {};
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
      const number = safeNumber(cost[key]);
      if (number !== undefined) safeCost[key] = number;
    }
    if (Object.keys(safeCost).length > 0) result.cost = safeCost;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function safeMessageEntry(entry: SessionEntry, message: MessageLike, content?: unknown): SessionEntry {
  const base = { type: "message", id: entry.id, parentId: null, timestamp: safeEntryTimestamp(entry.timestamp) };
  const timestamp = safeMessageTimestamp(message.timestamp, entry.timestamp);
  if (message.role === "user") {
    return { ...base, message: { role: "user", content: safeContent(message.content), timestamp } } as SessionEntry;
  }
  if (message.role === "assistant") {
    const usage = safeUsage(message.usage);
    return { ...base, message: {
      role: "assistant",
      content: content ?? [],
      ...(safeString(message.api) !== undefined ? { api: safeString(message.api) } : {}),
      ...(safeString(message.provider) !== undefined ? { provider: safeString(message.provider) } : {}),
      ...(safeString(message.model) !== undefined ? { model: safeString(message.model) } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(safeString(message.stopReason) !== undefined ? { stopReason: safeString(message.stopReason) } : {}),
      ...(safeString(message.errorMessage) !== undefined ? { errorMessage: safeString(message.errorMessage) } : {}),
      timestamp,
    } } as SessionEntry;
  }
  if (message.role === "toolResult") {
    const toolName = safeString(message.toolName);
    const details = record(message.details);
    const editDetails = toolName === "edit" && typeof details?.diff === "string"
      ? { details: { diff: details.diff } }
      : {};
    return { ...base, message: {
      role: "toolResult",
      toolCallId: safeString(message.toolCallId),
      toolName,
      content: safeContent(message.content),
      ...editDetails,
      isError: safeBoolean(message.isError) ?? false,
      timestamp,
    } } as SessionEntry;
  }
  if (message.role === "bashExecution") {
    return { ...base, message: {
      role: "bashExecution",
      command: safeString(message.command) ?? "",
      output: safeString(message.output) ?? "",
      exitCode: safeNumber(message.exitCode),
      cancelled: safeBoolean(message.cancelled) ?? false,
      truncated: safeBoolean(message.truncated) ?? false,
      timestamp,
    } } as SessionEntry;
  }
  if (message.role === "custom") {
    return { ...base, message: {
      role: "custom",
      customType: safeString(message.customType) ?? "custom",
      content: safeContent(message.content),
      display: safeBoolean(message.display) ?? true,
      timestamp,
    } } as SessionEntry;
  }
  if (message.role === "branchSummary") {
    return { ...base, message: {
      role: "branchSummary",
      summary: safeString(message.summary) ?? "",
      fromId: entry.id,
      timestamp,
    } } as SessionEntry;
  }
  return { ...base, message: {
    role: "compactionSummary",
    summary: safeString(message.summary) ?? "",
    tokensBefore: safeNumber(message.tokensBefore) ?? 0,
    timestamp,
  } } as SessionEntry;
}

function safeNonMessageEntry(entry: Exclude<SessionEntry, { type: "message" }>): SessionEntry | undefined {
  const base = { type: entry.type, id: entry.id, parentId: null, timestamp: safeEntryTimestamp(entry.timestamp) };
  switch (entry.type) {
    case "custom": return undefined;
    case "custom_message": return {
      ...base,
      customType: safeString(entry.customType) ?? "custom",
      content: safeContent(entry.content),
      display: safeBoolean(entry.display) ?? true,
    } as SessionEntry;
    case "compaction": return {
      ...base,
      summary: safeString(entry.summary) ?? "",
      firstKeptEntryId: entry.id,
      tokensBefore: safeNumber(entry.tokensBefore) ?? 0,
    } as SessionEntry;
    case "branch_summary": return {
      ...base,
      fromId: entry.id,
      summary: safeString(entry.summary) ?? "",
    } as SessionEntry;
    case "model_change": return {
      ...base,
      provider: safeString(entry.provider) ?? "unknown",
      modelId: safeString(entry.modelId) ?? "unknown",
    } as SessionEntry;
    case "thinking_level_change": return {
      ...base,
      thinkingLevel: safeString(entry.thinkingLevel) ?? "off",
    } as SessionEntry;
    case "session_info": return {
      ...base,
      ...(safeString(entry.name) !== undefined ? { name: safeString(entry.name) } : {}),
    } as SessionEntry;
    case "label": return {
      ...base,
      targetId: safeString(entry.targetId) ?? entry.id,
      ...(safeString(entry.label) !== undefined ? { label: safeString(entry.label) } : {}),
    } as SessionEntry;
  }
}

export function createSlicedSessionData(
  _originalHeader: SessionHeader,
  entries: readonly SessionEntry[],
  rows: readonly ShareRow[],
  selectedIds: ReadonlySet<string>,
): SlicedSessionData {
  assertUniqueSessionIdentifiers(entries);
  const selectedByEntry = selectedRowsByEntry(rows, selectedIds);
  const selectedToolCallIds = new Set(
    rows.filter((item) => item.toolCallId && selectedIds.has(item.id)).map((item) => item.toolCallId as string),
  );
  const selectedEntries: SessionEntry[] = [];

  for (const entry of entries) {
    const message = asMessage(entry);
    const selected = selectedByEntry.get(entry.id) ?? [];

    if (message?.role === "assistant") {
      const includeText = selected.some((item) => item.category === "assistant");
      const includeReasoning = selected.some((item) => item.category === "reasoning");
      const selectedCalls = new Set(selected.filter((item) => item.toolCallId).map((item) => item.toolCallId));
      const content = safeAssistantContent(message.content, includeText, includeReasoning, selectedCalls);
      if (content.length > 0 || (includeText && message.errorMessage)) {
        selectedEntries.push(safeMessageEntry(entry, message, content));
      }
      continue;
    }

    if (message?.role === "toolResult") {
      const selectedAsOrphan = selected.length > 0;
      if ((message.toolCallId && selectedToolCallIds.has(message.toolCallId)) || selectedAsOrphan) {
        selectedEntries.push(safeMessageEntry(entry, message));
      }
      continue;
    }

    if (selected.length === 0) continue;
    if (message) {
      selectedEntries.push(safeMessageEntry(entry, message));
    } else {
      const safeEntry = safeNonMessageEntry(entry as Exclude<SessionEntry, { type: "message" }>);
      if (safeEntry) selectedEntries.push(safeEntry);
    }
  }

  let parentId: string | null = null;
  const linearEntries = selectedEntries.map((entry) => {
    const linear = { ...entry, parentId } as SessionEntry;
    parentId = entry.id;
    return linear;
  });
  const header: SessionHeader = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: ".",
  };
  return { header, entries: linearEntries, leafId: parentId };
}

export function writeSlicedSessionJsonl(path: string, data: SlicedSessionData): void {
  const lines = [JSON.stringify(data.header), ...data.entries.map((entry) => JSON.stringify(entry))];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}
