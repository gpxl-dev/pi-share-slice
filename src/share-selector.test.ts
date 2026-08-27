import { describe, expect, test } from "bun:test";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { selectorPageSize, ShareSelector, type ShareSelectionResult } from "./share-selector.ts";
import type { ShareRow } from "./slice.ts";

const defaults: Record<string, string[]> = {
  "tui.select.up": ["up"],
  "tui.select.down": ["down"],
  "tui.select.pageUp": ["pageUp"],
  "tui.select.pageDown": ["pageDown"],
  "tui.select.confirm": ["enter"],
  "tui.select.cancel": ["escape", "ctrl+c"],
  "app.tree.filter.default": ["ctrl+d"],
  "app.tree.filter.noTools": ["ctrl+t"],
  "app.tree.filter.userOnly": ["ctrl+u"],
  "app.tree.filter.labeledOnly": ["ctrl+l"],
  "app.tree.filter.all": ["ctrl+a"],
  "app.tree.filter.cycleForward": ["ctrl+o"],
  "app.tree.filter.cycleBackward": ["ctrl+shift+o"],
};
const keybindings = {
  matches(data: string, binding: string) {
    return (defaults[binding] ?? []).some((candidate) => matchesKey(data, candidate as Parameters<typeof matchesKey>[1]));
  },
} as unknown as KeybindingsManager;
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const rows: ShareRow[] = [
  { id: "u", category: "user", entryId: "u", preview: "alpha", searchableText: "alpha", initiallySelected: true, toolLike: false, defaultVisible: true },
  { id: "a", category: "assistant", entryId: "a", preview: "needle", searchableText: "needle", initiallySelected: true, toolLike: false, defaultVisible: true },
  { id: "t", category: "tool", entryId: "t", preview: "tool", searchableText: "tool", initiallySelected: false, toolLike: true, defaultVisible: true },
];

describe("share selector component", () => {
  test("keeps every rendered line within the supplied width", () => {
    const selector = new ShareSelector({
      rows, filterMode: "default", systemMode: "none", getPageSize: () => 5,
      theme, keybindings, requestRender: () => {}, done: () => {},
    });
    for (const line of selector.render(24)) expect(visibleWidth(line)).toBeLessThanOrEqual(24);
  });

  test("uses the current terminal height for rendering and page movement", () => {
    const manyRows = Array.from({ length: 80 }, (_, index): ShareRow => ({
      id: `row-${index}`, category: "user", entryId: `row-${index}`, preview: `item ${index}`,
      searchableText: `item ${index}`, initiallySelected: false, toolLike: false, defaultVisible: true,
    }));
    let terminalRows = 80;
    const selector = new ShareSelector({
      rows: manyRows, filterMode: "default", systemMode: "none",
      getPageSize: () => selectorPageSize(terminalRows),
      theme, keybindings, requestRender: () => {}, done: () => {},
    });

    selector.handleInput("G");
    let rendered = selector.render(80);
    expect(rendered).toHaveLength(Math.floor(terminalRows * 0.9));
    expect(rendered.some((line) => line.includes("item 79"))).toBeTrue();
    expect(rendered.at(-2)).toContain("shift+move");

    terminalRows = 20;
    rendered = selector.render(80);
    expect(rendered).toHaveLength(Math.floor(terminalRows * 0.9));
    expect(rendered.some((line) => line.includes("item 79"))).toBeTrue();
    expect(rendered.at(-2)).toContain("shift+move");

    selector.handleInput("\x1b[5~");
    expect(selector.state.currentRow?.id).toBe("row-70");
    terminalRows = 12;
    selector.handleInput("\x1b[5~");
    expect(selector.state.currentRow?.id).toBe("row-69");
    expect(selectorPageSize(10)).toBe(1);
  });

  test("routes visual, search, bulk, filter, and submit keys", () => {
    let result: ShareSelectionResult | null | undefined;
    const selector = new ShareSelector({
      rows, filterMode: "default", systemMode: "none", getPageSize: () => 5,
      theme, keybindings, requestRender: () => {}, done: (value) => { result = value; },
    });
    selector.handleInput("C");
    selector.handleInput("v");
    selector.handleInput("G");
    selector.handleInput(" ");
    expect(selector.state.selectedCount).toBe(3);
    selector.handleInput("T");
    expect(selector.state.selectedIds.has("t")).toBeFalse();
    selector.handleInput("s");
    expect(selector.state.systemMode).toBe("without-tools");
    selector.handleInput("/");
    for (const character of "needle") selector.handleInput(character);
    selector.handleInput("\r");
    expect(selector.state.visibleRows.map((row) => row.id)).toEqual(["a"]);
    selector.handleInput("\x1b");
    expect(selector.state.searchQuery).toBe("");
    selector.handleInput("\x15");
    expect(selector.state.filterMode).toBe("user-only");
    selector.handleInput("\r");
    expect(result?.selectedIds).toEqual(["u", "a"]);
    expect(result?.systemMode).toBe("without-tools");
  });
});
