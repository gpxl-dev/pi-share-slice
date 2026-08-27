import { describe, expect, test } from "bun:test";
import type { ShareRow } from "./slice.ts";
import { SelectionState } from "./selection-state.ts";

function makeRow(index: number, category: ShareRow["category"], options: Partial<ShareRow> = {}): ShareRow {
  return {
    id: `row-${index}`,
    category,
    entryId: `entry-${index}`,
    preview: `message ${index}`,
    searchableText: options.searchableText ?? `message ${index}`,
    initiallySelected: options.initiallySelected ?? false,
    toolLike: options.toolLike ?? category === "tool",
    defaultVisible: options.defaultVisible ?? true,
    ...options,
  };
}

const rows = [
  makeRow(0, "user", { initiallySelected: true, searchableText: "user alpha" }),
  makeRow(1, "assistant", { initiallySelected: true, searchableText: "assistant beta" }),
  makeRow(2, "reasoning", { searchableText: "reasoning hidden needle" }),
  makeRow(3, "tool", { searchableText: "tool gamma" }),
  makeRow(4, "context", { label: "checkpoint", searchableText: "context delta" }),
  makeRow(5, "context", { defaultVisible: false, searchableText: "bookkeeping epsilon" }),
];

describe("selection state", () => {
  test("literal search and filters retain hidden selection", () => {
    const state = new SelectionState(rows, { filterMode: "default", systemMode: "none" });
    expect([...state.selectedIds]).toEqual(["row-0", "row-1"]);
    state.setSearchQuery("BETA");
    expect(state.visibleRows.map((item) => item.id)).toEqual(["row-1"]);
    expect(state.selectedIds.has("row-0")).toBeTrue();
    state.deselectVisible();
    expect(state.selectedIds.has("row-0")).toBeTrue();
    state.setSearchQuery("");
    expect(state.selectedIds.has("row-1")).toBeFalse();
  });

  test("tree filter modes apply to the view only", () => {
    const state = new SelectionState(rows, { filterMode: "default", systemMode: "none" });
    state.setFilterMode("no-tools");
    expect(state.visibleRows.some((item) => item.category === "tool")).toBeFalse();
    state.setFilterMode("user-only");
    expect(state.visibleRows.map((item) => item.category)).toEqual(["user"]);
    state.setFilterMode("labeled-only");
    expect(state.visibleRows.map((item) => item.id)).toEqual(["row-4"]);
    state.setFilterMode("all");
    expect(state.visibleRows).toHaveLength(6);
  });

  test("visual ranges add inclusively and support half-page/end movement", () => {
    const state = new SelectionState(rows, { filterMode: "all", systemMode: "none" });
    state.clearAll();
    state.move(1);
    state.toggleVisualMode();
    state.halfPageVisual(1, 4);
    expect([...state.visualRangeIds]).toEqual(["row-1", "row-2", "row-3"]);
    state.moveToEnd();
    expect(state.visualRangeIds.size).toBe(5);
    state.applySpace();
    expect([...state.selectedIds]).toEqual(["row-1", "row-2", "row-3", "row-4", "row-5"]);
    expect(state.visualMode).toBeFalse();
  });

  test("shift ranges select inclusively across arrows and large jumps", () => {
    const state = new SelectionState(rows, { filterMode: "all", systemMode: "none" });
    state.clearAll();
    state.shiftMove(1);
    state.shiftMove(1);
    expect([...state.selectedIds]).toEqual(["row-0", "row-1", "row-2"]);
    state.shiftToEnd();
    expect(state.selectedIds.size).toBe(6);
    state.clearAll();
    state.moveToEnd();
    state.shiftPage(-1, 3);
    expect([...state.selectedIds]).toEqual(["row-2", "row-3", "row-4", "row-5"]);
    state.shiftToStart();
    expect(state.selectedIds.size).toBe(6);
  });

  test("bulk controls and system cycling are explicit", () => {
    const state = new SelectionState(rows, { filterMode: "all", systemMode: "none" });
    state.selectVisible();
    state.removeTools();
    expect(state.selectedIds.has("row-3")).toBeFalse();
    state.deselectVisible();
    expect(state.selectedCount).toBe(0);
    state.cycleSystemMode();
    expect(state.systemMode).toBe("without-tools");
    state.cycleSystemMode();
    expect(state.systemMode).toBe("with-tools");
    state.cycleSystemMode();
    expect(state.systemMode).toBe("none");
  });
});
