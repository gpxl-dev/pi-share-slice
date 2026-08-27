import { FILTER_MODES, SYSTEM_MODES, type FilterMode, type SystemMode } from "./config.ts";
import type { ShareRow } from "./slice.ts";

export class SelectionState {
  readonly rows: readonly ShareRow[];
  readonly selectedIds: Set<string>;
  filterMode: FilterMode;
  searchQuery = "";
  systemMode: SystemMode;
  cursorIndex = 0;
  visualAnchorId: string | null = null;
  private shiftAnchorId: string | null = null;

  constructor(rows: readonly ShareRow[], options: { filterMode: FilterMode; systemMode: SystemMode }) {
    this.rows = rows;
    this.filterMode = options.filterMode;
    this.systemMode = options.systemMode;
    this.selectedIds = new Set(rows.filter((item) => item.initiallySelected).map((item) => item.id));
    this.clampCursor();
  }

  get visibleRows(): ShareRow[] {
    const query = this.searchQuery.toLocaleLowerCase();
    return this.rows.filter((item) => {
      let passes = false;
      switch (this.filterMode) {
        case "user-only": passes = item.category === "user"; break;
        case "no-tools": passes = item.defaultVisible && !item.toolLike; break;
        case "labeled-only": passes = !!item.label; break;
        case "all": passes = true; break;
        default: passes = item.defaultVisible;
      }
      return passes && (!query || item.searchableText.toLocaleLowerCase().includes(query));
    });
  }

  get currentRow(): ShareRow | undefined {
    return this.visibleRows[this.cursorIndex];
  }

  get selectedCount(): number {
    return this.selectedIds.size;
  }

  get visualMode(): boolean {
    return this.visualAnchorId !== null;
  }

  get visualRangeIds(): Set<string> {
    if (!this.visualAnchorId) return new Set();
    const visible = this.visibleRows;
    const anchor = visible.findIndex((item) => item.id === this.visualAnchorId);
    if (anchor < 0 || visible.length === 0) return new Set();
    const start = Math.min(anchor, this.cursorIndex);
    const end = Math.max(anchor, this.cursorIndex);
    return new Set(visible.slice(start, end + 1).map((item) => item.id));
  }

  setSearchQuery(query: string): void {
    const currentId = this.currentRow?.id;
    this.searchQuery = query;
    this.restoreCursor(currentId);
    if (this.visualAnchorId && !this.visibleRows.some((item) => item.id === this.visualAnchorId)) {
      this.visualAnchorId = null;
    }
    this.shiftAnchorId = null;
  }

  setFilterMode(mode: FilterMode): void {
    const currentId = this.currentRow?.id;
    this.filterMode = mode;
    this.restoreCursor(currentId);
    if (this.visualAnchorId && !this.visibleRows.some((item) => item.id === this.visualAnchorId)) {
      this.visualAnchorId = null;
    }
    this.shiftAnchorId = null;
  }

  cycleFilter(direction: 1 | -1 = 1): void {
    const index = FILTER_MODES.indexOf(this.filterMode);
    this.setFilterMode(FILTER_MODES[(index + direction + FILTER_MODES.length) % FILTER_MODES.length] ?? "default");
  }

  cycleSystemMode(): void {
    const index = SYSTEM_MODES.indexOf(this.systemMode);
    this.systemMode = SYSTEM_MODES[(index + 1) % SYSTEM_MODES.length] ?? "none";
  }

  move(delta: number): void {
    this.moveTo(this.cursorIndex + delta);
    this.shiftAnchorId = null;
  }

  moveToStart(): void {
    this.moveTo(0);
    this.shiftAnchorId = null;
  }

  moveToEnd(): void {
    this.moveTo(this.visibleRows.length - 1);
    this.shiftAnchorId = null;
  }

  page(direction: 1 | -1, pageSize: number): void {
    this.move(direction * Math.max(1, pageSize));
  }

  halfPageVisual(direction: 1 | -1, pageSize: number): void {
    if (!this.visualMode) return;
    this.moveTo(this.cursorIndex + direction * Math.max(1, Math.floor(pageSize / 2)));
  }

  toggleVisualMode(): void {
    if (this.visualAnchorId) {
      this.visualAnchorId = null;
    } else {
      this.visualAnchorId = this.currentRow?.id ?? null;
    }
    this.shiftAnchorId = null;
  }

  applySpace(): void {
    if (this.visualMode) {
      for (const id of this.visualRangeIds) this.selectedIds.add(id);
      this.visualAnchorId = null;
      return;
    }
    const current = this.currentRow;
    if (!current) return;
    if (this.selectedIds.has(current.id)) this.selectedIds.delete(current.id);
    else this.selectedIds.add(current.id);
    this.shiftAnchorId = null;
  }

  shiftMove(delta: number): void {
    const current = this.currentRow;
    if (!current) return;
    this.shiftAnchorId ??= current.id;
    this.moveTo(this.cursorIndex + delta);
    this.selectBetween(this.shiftAnchorId, this.currentRow?.id);
  }

  shiftToStart(): void {
    this.shiftToIndex(0);
  }

  shiftToEnd(): void {
    this.shiftToIndex(this.visibleRows.length - 1);
  }

  shiftPage(direction: 1 | -1, pageSize: number): void {
    this.shiftToIndex(this.cursorIndex + direction * Math.max(1, pageSize));
  }

  selectVisible(): void {
    for (const item of this.visibleRows) this.selectedIds.add(item.id);
    this.shiftAnchorId = null;
  }

  deselectVisible(): void {
    for (const item of this.visibleRows) this.selectedIds.delete(item.id);
    this.shiftAnchorId = null;
  }

  clearAll(): void {
    this.selectedIds.clear();
    this.shiftAnchorId = null;
    this.visualAnchorId = null;
  }

  removeTools(): void {
    for (const item of this.rows) if (item.toolLike) this.selectedIds.delete(item.id);
  }

  private shiftToIndex(index: number): void {
    const current = this.currentRow;
    if (!current) return;
    this.shiftAnchorId ??= current.id;
    this.moveTo(index);
    this.selectBetween(this.shiftAnchorId, this.currentRow?.id);
  }

  private selectBetween(firstId: string | null, secondId: string | undefined): void {
    if (!firstId || !secondId) return;
    const visible = this.visibleRows;
    const first = visible.findIndex((item) => item.id === firstId);
    const second = visible.findIndex((item) => item.id === secondId);
    if (first < 0 || second < 0) return;
    const start = Math.min(first, second);
    const end = Math.max(first, second);
    for (const item of visible.slice(start, end + 1)) this.selectedIds.add(item.id);
  }

  private moveTo(index: number): void {
    const length = this.visibleRows.length;
    this.cursorIndex = length === 0 ? 0 : Math.max(0, Math.min(index, length - 1));
  }

  private restoreCursor(preferredId?: string): void {
    const visible = this.visibleRows;
    if (visible.length === 0) {
      this.cursorIndex = 0;
      return;
    }
    const preferred = preferredId ? visible.findIndex((item) => item.id === preferredId) : -1;
    if (preferred >= 0) this.cursorIndex = preferred;
    else this.clampCursor();
  }

  private clampCursor(): void {
    this.moveTo(this.cursorIndex);
  }
}
