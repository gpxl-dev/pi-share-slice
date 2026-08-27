import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, getConfigPath, loadConfig, parseConfig, saveConfig } from "./config.ts";

describe("share slice config", () => {
  test("missing files use privacy-preserving defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "share-slice-config-"));
    try {
      const loaded = loadConfig({ agentDir: dir });
      expect(loaded.config).toEqual(DEFAULT_CONFIG);
      expect(loaded.warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid fields fall back independently", () => {
    const parsed = parseConfig({
      defaults: {
        user: false,
        assistant: "yes",
        reasoning: true,
        patchViewer: "yes",
        hideViewerSidebar: "yes",
        hideViewerToggles: 1,
        condenseViewerSummary: null,
        systemContext: "everything",
        filterMode: "wat",
      },
    });
    expect(parsed.config.defaults.user).toBeFalse();
    expect(parsed.config.defaults.assistant).toBeTrue();
    expect(parsed.config.defaults.reasoning).toBeTrue();
    expect(parsed.config.defaults.patchViewer).toBeTrue();
    expect(parsed.config.defaults.hideViewerSidebar).toBeFalse();
    expect(parsed.config.defaults.hideViewerToggles).toBeFalse();
    expect(parsed.config.defaults.condenseViewerSummary).toBeFalse();
    expect(parsed.config.defaults.systemContext).toBe("none");
    expect(parsed.config.defaults.filterMode).toBe("user-assistant-only");
    expect(parsed.warnings).toHaveLength(7);
  });

  test("accepts viewer customization options", () => {
    const parsed = parseConfig({
      defaults: {
        filterMode: "user-assistant-only",
        patchViewer: false,
        hideViewerSidebar: true,
        hideViewerToggles: true,
        condenseViewerSummary: true,
      },
    });
    expect(parsed.config.defaults.filterMode).toBe("user-assistant-only");
    expect(parsed.config.defaults.patchViewer).toBeFalse();
    expect(parsed.config.defaults.hideViewerSidebar).toBeTrue();
    expect(parsed.config.defaults.hideViewerToggles).toBeTrue();
    expect(parsed.config.defaults.condenseViewerSummary).toBeTrue();
    expect(parsed.warnings).toEqual([]);
  });

  test("malformed JSON warns and save writes valid global config", () => {
    const dir = mkdtempSync(join(tmpdir(), "share-slice-config-"));
    try {
      writeFileSync(getConfigPath(dir), "{", "utf8");
      expect(loadConfig({ agentDir: dir }).warnings[0]).toContain("Invalid JSON");
      const config = { defaults: { ...DEFAULT_CONFIG.defaults, systemContext: "with-tools" as const } };
      const path = saveConfig(config, { agentDir: dir });
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(config);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
