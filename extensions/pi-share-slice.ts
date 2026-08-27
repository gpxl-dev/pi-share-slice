import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, hyperlink, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { FILTER_MODES, loadConfig, saveConfig, SYSTEM_MODES, type ShareSliceConfig } from "../src/config.ts";
import { createPrivateGist, GistShareError, type GistShareResult } from "../src/gist.ts";
import { exportSlicedSessionToHtml } from "../src/pi-internals.ts";
import { selectorPageSize, ShareSelector, type ShareSelectionResult } from "../src/share-selector.ts";
import { collectLabels, createSlicedSessionData, deriveShareRows, writeSlicedSessionJsonl } from "../src/slice.ts";
import { buildPresentationState } from "../src/system-context.ts";

async function selectSlice(
  ctx: ExtensionCommandContext,
  config: ShareSliceConfig,
): Promise<ShareSelectionResult | null> {
  const branch = ctx.sessionManager.getBranch();
  const labels = collectLabels(ctx.sessionManager.getTree());
  const rows = deriveShareRows(branch, config.defaults, labels);
  if (rows.length === 0) {
    ctx.ui.notify("There are no shareable messages on the active branch.", "warning");
    return null;
  }

  return ctx.ui.custom<ShareSelectionResult | null>(
    (tui, theme, keybindings, done) => new ShareSelector({
      rows,
      filterMode: config.defaults.filterMode,
      systemMode: config.defaults.systemContext,
      getPageSize: () => selectorPageSize(tui.terminal.rows),
      theme,
      keybindings,
      requestRender: () => tui.requestRender(),
      done,
    }),
    {
      overlay: true,
      overlayOptions: {
        width: "90%",
        minWidth: 36,
        maxHeight: "90%",
        anchor: "center",
        margin: 1,
      },
    },
  );
}

type UploadOutcome = { result?: GistShareResult; error?: Error; cancelled?: boolean };

async function uploadWithLoader(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  htmlPath: string,
): Promise<UploadOutcome> {
  return ctx.ui.custom<UploadOutcome>((tui, theme, _keybindings, done) => {
    const loader = new BorderedLoader(tui, theme, "Creating secret/unlisted Gist...");
    const controller = new AbortController();
    let settled = false;
    const finish = (outcome: UploadOutcome) => {
      if (settled) return;
      settled = true;
      done(outcome);
    };
    loader.onAbort = () => {
      controller.abort();
    };
    void createPrivateGist(
      htmlPath,
      (command, args, options) => pi.exec(command, args, options),
      { signal: controller.signal },
    ).then((result) => finish({ result })).catch((error: unknown) => {
      if (error instanceof GistShareError && error.kind === "cancelled") {
        finish({ cancelled: true });
      } else {
        finish({ error: error instanceof Error ? error : new Error(String(error)) });
      }
    });
    return loader;
  });
}

async function shareSlice(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/share-slice requires Pi's interactive TUI.", "error");
    return;
  }

  await ctx.waitForIdle();
  const loaded = loadConfig();
  for (const warning of loaded.warnings) ctx.ui.notify(warning, "warning");
  let selection: ShareSelectionResult | null;
  try {
    selection = await selectSlice(ctx, loaded.config);
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  if (!selection) return;
  if (selection.selectedIds.length === 0) {
    ctx.ui.notify("Nothing selected. Select at least one message before sharing.", "warning");
    return;
  }

  let temporaryDirectory: string | undefined;
  try {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "pi-share-slice-"));
    const sessionPath = join(temporaryDirectory, "session.jsonl");
    const htmlPath = join(temporaryDirectory, "session.html");
    const branch = ctx.sessionManager.getBranch();
    const labels = collectLabels(ctx.sessionManager.getTree());
    const rows = deriveShareRows(branch, loaded.config.defaults, labels);
    const header = ctx.sessionManager.getHeader();
    if (!header) {
      ctx.ui.notify("The active session has no session header to export.", "error");
      return;
    }
    const sliced = createSlicedSessionData(
      header,
      branch,
      rows,
      new Set(selection.selectedIds),
    );
    if (sliced.entries.length === 0) {
      ctx.ui.notify("The selected rows did not produce any shareable session entries.", "warning");
      return;
    }
    writeSlicedSessionJsonl(sessionPath, sliced);

    const presentation = await buildPresentationState(selection.systemMode, ctx, pi);
    await exportSlicedSessionToHtml({
      sessionPath,
      outputPath: htmlPath,
      cwd: ctx.cwd,
      theme: ctx.ui.theme,
      presentation,
    });

    const upload = await uploadWithLoader(pi, ctx, htmlPath);
    if (upload.cancelled) {
      ctx.ui.notify("Share cancelled.", "info");
      return;
    }
    if (upload.error) {
      ctx.ui.notify(upload.error.message, "error");
      return;
    }
    if (upload.result) {
      const viewer = hyperlink(upload.result.viewerUrl, upload.result.viewerUrl);
      const gist = hyperlink(upload.result.gistUrl, upload.result.gistUrl);
      ctx.ui.notify(`Share URL: ${viewer}\nGist: ${gist}`, "info");
    }
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  } finally {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function openSettings(ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/share-slice-settings requires Pi's interactive TUI.", "error");
    return;
  }
  const loaded = loadConfig();
  for (const warning of loaded.warnings) ctx.ui.notify(warning, "warning");
  const config: ShareSliceConfig = { defaults: { ...loaded.config.defaults } };
  const items: SettingItem[] = [
    { id: "user", label: "Select user messages", currentValue: String(config.defaults.user), values: ["true", "false"] },
    { id: "assistant", label: "Select assistant text", currentValue: String(config.defaults.assistant), values: ["true", "false"] },
    { id: "reasoning", label: "Select assistant reasoning", currentValue: String(config.defaults.reasoning), values: ["true", "false"] },
    { id: "tool", label: "Select tool bundles", currentValue: String(config.defaults.tool), values: ["true", "false"] },
    { id: "context", label: "Select context rows", currentValue: String(config.defaults.context), values: ["true", "false"] },
    { id: "systemContext", label: "System context", currentValue: config.defaults.systemContext, values: [...SYSTEM_MODES] },
    { id: "filterMode", label: "Initial filter", currentValue: config.defaults.filterMode, values: [...FILTER_MODES] },
  ];

  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", theme.bold("Share Slice Defaults")), 1, 1));
    const list = new SettingsList(
      items,
      Math.min(items.length + 2, 12),
      getSettingsListTheme(),
      (id, value) => {
        if (id === "systemContext") config.defaults.systemContext = value as typeof config.defaults.systemContext;
        else if (id === "filterMode") config.defaults.filterMode = value as typeof config.defaults.filterMode;
        else config.defaults[id as "user" | "assistant" | "reasoning" | "tool" | "context"] = value === "true";
        try {
          saveConfig(config);
        } catch (error) {
          ctx.ui.notify(`Could not save defaults: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      () => done(undefined),
    );
    container.addChild(list);
    return {
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

export default function piShareSlice(pi: ExtensionAPI): void {
  pi.registerCommand("share-slice", {
    description: "Select active-branch messages and share them with Pi's HTML viewer",
    handler: async (_args, ctx) => shareSlice(pi, ctx),
  });
  pi.registerCommand("share-slice-settings", {
    description: "Configure global defaults for /share-slice",
    handler: async (_args, ctx) => openSettings(ctx),
  });
}
