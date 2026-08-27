import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";
import type { FilterMode, SystemMode } from "./config.ts";
import { SelectionState } from "./selection-state.ts";
import type { ShareRow } from "./slice.ts";

export interface ShareSelectionResult {
  selectedIds: string[];
  systemMode: SystemMode;
}

export function selectorPageSize(terminalRows: number): number {
  const overlayHeight = Math.min(Math.floor(terminalRows * 0.9), Math.max(1, terminalRows - 2));
  return Math.max(1, overlayHeight - 9);
}

interface SelectorOptions {
  rows: readonly ShareRow[];
  filterMode: FilterMode;
  systemMode: SystemMode;
  getPageSize: () => number;
  theme: Theme;
  keybindings: KeybindingsManager;
  requestRender: () => void;
  done: (result: ShareSelectionResult | null) => void;
}

function key(data: string, id: Parameters<typeof matchesKey>[1]): boolean {
  return matchesKey(data, id);
}

export class ShareSelector implements Component, Focusable {
  readonly state: SelectionState;
  private readonly getPageSize: () => number;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly requestRender: () => void;
  private readonly done: (result: ShareSelectionResult | null) => void;
  private readonly searchInput = new Input();
  private searchMode = false;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value && this.searchMode;
  }

  constructor(options: SelectorOptions) {
    this.state = new SelectionState(options.rows, {
      filterMode: options.filterMode,
      systemMode: options.systemMode,
    });
    this.getPageSize = options.getPageSize;
    this.theme = options.theme;
    this.keybindings = options.keybindings;
    this.requestRender = options.requestRender;
    this.done = options.done;
  }

  invalidate(): void {
    this.searchInput.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const visible = this.state.visibleRows;
    const selected = this.state.selectedCount;
    const visualIds = this.state.visualRangeIds;
    const pageSize = this.currentPageSize();
    const start = Math.max(0, Math.min(
      this.state.cursorIndex - Math.floor(pageSize / 2),
      Math.max(0, visible.length - pageSize),
    ));
    const end = Math.min(visible.length, start + pageSize);
    const lines: string[] = [];
    const border = this.theme.fg("borderAccent", "─".repeat(safeWidth));

    lines.push(border);
    lines.push(truncateToWidth(` ${this.theme.bold(this.theme.fg("accent", "Share session slice"))}`, safeWidth, ""));
    lines.push(truncateToWidth(
      ` ${this.theme.fg("muted", `selected ${selected}/${this.state.rows.length} · visible ${visible.length} · filter ${this.state.filterMode} · system ${this.state.systemMode}${this.state.visualMode ? " · VISUAL" : ""}`)}`,
      safeWidth,
      "",
    ));

    if (this.searchMode) {
      const prefix = " / ";
      const inputWidth = Math.max(1, safeWidth - prefix.length - 1);
      const inputLines = this.searchInput.render(inputWidth);
      lines.push(truncateToWidth(
        `${this.theme.fg("accent", prefix)}${inputLines[0] ?? ""}`,
        safeWidth,
        "",
      ));
    } else {
      const query = this.state.searchQuery ? ` · search “${this.state.searchQuery}”` : "";
      lines.push(truncateToWidth(
        ` ${this.theme.fg("dim", `↑↓/jk move · space select · v visual · / search${query}`)}`,
        safeWidth,
        "",
      ));
    }

    lines.push(this.theme.fg("border", "─".repeat(safeWidth)));
    if (visible.length === 0) {
      lines.push(truncateToWidth(` ${this.theme.fg("warning", "No messages match the active filters.")}`, safeWidth, ""));
    } else {
      for (let index = start; index < end; index++) {
        const item = visible[index];
        if (!item) continue;
        const current = index === this.state.cursorIndex;
        const cursor = current ? this.theme.fg("accent", "›") : " ";
        const mark = this.state.selectedIds.has(item.id)
          ? this.theme.fg("success", "[✓]")
          : this.theme.fg("dim", "[ ]");
        const role = this.roleLabel(item);
        let line = truncateToWidth(` ${cursor} ${mark} ${role} ${item.preview}`, safeWidth, "…");
        if (current || visualIds.has(item.id)) line = this.theme.bg("selectedBg", line);
        lines.push(line);
      }
    }

    lines.push(this.theme.fg("border", "─".repeat(safeWidth)));
    lines.push(truncateToWidth(
      ` ${this.theme.fg("dim", "a all · n none visible · C clear all · T remove tools · s system · ctrl+o filters · enter share")}`,
      safeWidth,
      "",
    ));
    lines.push(truncateToWidth(
      ` ${this.theme.fg("dim", "shift+move selects · G end · visual ctrl+d half-page · esc cancel")}`,
      safeWidth,
      "",
    ));
    lines.push(border);
    return lines;
  }

  handleInput(data: string): void {
    if (this.searchMode) {
      if (this.keybindings.matches(data, "tui.select.cancel")) {
        this.leaveSearch();
      } else if (this.keybindings.matches(data, "tui.select.confirm")) {
        this.leaveSearch();
      } else {
        this.searchInput.handleInput(data);
        this.state.setSearchQuery(this.searchInput.getValue());
      }
      this.requestRender();
      return;
    }

    if (this.keybindings.matches(data, "tui.select.cancel")) {
      if (this.state.searchQuery) {
        this.searchInput.setValue("");
        this.state.setSearchQuery("");
      } else {
        this.done(null);
      }
    } else if (key(data, Key.slash)) {
      this.searchMode = true;
      this.searchInput.focused = this._focused;
    } else if (key(data, Key.shift("up"))) {
      this.state.shiftMove(-1);
    } else if (key(data, Key.shift("down"))) {
      this.state.shiftMove(1);
    } else if (key(data, Key.shift("pageUp"))) {
      this.state.shiftPage(-1, this.currentPageSize());
    } else if (key(data, Key.shift("pageDown"))) {
      this.state.shiftPage(1, this.currentPageSize());
    } else if (key(data, Key.shift("home"))) {
      this.state.shiftToStart();
    } else if (key(data, Key.shift("end"))) {
      this.state.shiftToEnd();
    } else if (this.keybindings.matches(data, "tui.select.up") || key(data, "k")) {
      this.state.move(-1);
    } else if (this.keybindings.matches(data, "tui.select.down") || key(data, "j")) {
      this.state.move(1);
    } else if (this.keybindings.matches(data, "tui.select.pageUp")) {
      this.state.page(-1, this.currentPageSize());
    } else if (this.keybindings.matches(data, "tui.select.pageDown")) {
      this.state.page(1, this.currentPageSize());
    } else if (key(data, Key.space)) {
      this.state.applySpace();
    } else if (key(data, "v")) {
      this.state.toggleVisualMode();
    } else if ((data === "G" || key(data, Key.shift("g")))) {
      this.state.moveToEnd();
    } else if (key(data, Key.ctrl("d")) && this.state.visualMode) {
      this.state.halfPageVisual(1, this.currentPageSize());
    } else if (data === "C" || key(data, Key.shift("c"))) {
      this.state.clearAll();
    } else if (data === "T" || key(data, Key.shift("t"))) {
      this.state.removeTools();
    } else if (key(data, "a")) {
      this.state.selectVisible();
    } else if (key(data, "n")) {
      this.state.deselectVisible();
    } else if (key(data, "s")) {
      this.state.cycleSystemMode();
    } else if (this.keybindings.matches(data, "app.tree.filter.default")) {
      this.state.setFilterMode("default");
    } else if (this.keybindings.matches(data, "app.tree.filter.noTools")) {
      this.state.setFilterMode(this.state.filterMode === "no-tools" ? "default" : "no-tools");
    } else if (this.keybindings.matches(data, "app.tree.filter.userOnly")) {
      this.state.setFilterMode(this.state.filterMode === "user-only" ? "default" : "user-only");
    } else if (this.keybindings.matches(data, "app.tree.filter.labeledOnly")) {
      this.state.setFilterMode(this.state.filterMode === "labeled-only" ? "default" : "labeled-only");
    } else if (this.keybindings.matches(data, "app.tree.filter.all")) {
      this.state.setFilterMode(this.state.filterMode === "all" ? "default" : "all");
    } else if (this.keybindings.matches(data, "app.tree.filter.cycleBackward")) {
      this.state.cycleFilter(-1);
    } else if (this.keybindings.matches(data, "app.tree.filter.cycleForward")) {
      this.state.cycleFilter(1);
    } else if (this.keybindings.matches(data, "tui.select.confirm")) {
      this.done({ selectedIds: [...this.state.selectedIds], systemMode: this.state.systemMode });
    }
    this.requestRender();
  }

  private currentPageSize(): number {
    return Math.max(1, Math.floor(this.getPageSize()));
  }

  private leaveSearch(): void {
    this.searchMode = false;
    this.searchInput.focused = false;
    this.state.setSearchQuery(this.searchInput.getValue());
  }

  private roleLabel(item: ShareRow): string {
    switch (item.category) {
      case "user": return this.theme.fg("accent", "user     ");
      case "assistant": return this.theme.fg("success", "assistant");
      case "reasoning": return this.theme.fg("warning", "reasoning");
      case "tool": return this.theme.fg("toolTitle", "tool     ");
      case "context": return this.theme.fg("customMessageLabel", "context  ");
    }
  }
}
