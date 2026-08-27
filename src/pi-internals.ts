import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SessionManager,
  VERSION,
  getPackageDir,
  type BuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";

export class PiCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiCompatibilityError";
  }
}

type Importer = (specifier: string) => Promise<unknown>;

type ExportSessionToHtml = (
  sessionManager: SessionManager,
  state: unknown,
  options: { outputPath: string; themeName?: string; toolRenderer?: unknown },
) => Promise<string>;

type BuildSystemPrompt = (options: BuildSystemPromptOptions) => string;

type CreateToolHtmlRenderer = (options: {
  getToolDefinition: (name: string) => unknown;
  theme: Theme;
  cwd: string;
}) => unknown;

type CreateAllToolDefinitions = (cwd: string) => Record<string, unknown>;

export interface PiInternalModules {
  exportSessionToHtml: ExportSessionToHtml;
  buildSystemPrompt: BuildSystemPrompt;
  createToolHtmlRenderer?: CreateToolHtmlRenderer;
  createAllToolDefinitions?: CreateAllToolDefinitions;
}

export interface LoadPiInternalsOptions {
  packageDir?: string;
  version?: string;
  exists?: typeof existsSync;
  importer?: Importer;
}

async function importFirst(
  packageDir: string,
  relativeCandidates: readonly string[],
  exists: typeof existsSync,
  importer: Importer,
): Promise<Record<string, unknown> | undefined> {
  for (const relativePath of relativeCandidates) {
    const absolutePath = join(packageDir, relativePath);
    if (!exists(absolutePath)) continue;
    const imported = await importer(pathToFileURL(absolutePath).href);
    if (imported && typeof imported === "object") return imported as Record<string, unknown>;
  }
  return undefined;
}

export async function loadPiInternals(options: LoadPiInternalsOptions = {}): Promise<PiInternalModules> {
  const packageDir = options.packageDir ?? getPackageDir();
  const version = options.version ?? VERSION;
  const exists = options.exists ?? existsSync;
  const importer = options.importer ?? ((specifier) => import(specifier));

  try {
    const exporter = await importFirst(packageDir, [
      "dist/core/export-html/index.js",
      "src/core/export-html/index.ts",
    ], exists, importer);
    const systemPrompt = await importFirst(packageDir, [
      "dist/core/system-prompt.js",
      "src/core/system-prompt.ts",
    ], exists, importer);

    if (typeof exporter?.exportSessionToHtml !== "function" || typeof systemPrompt?.buildSystemPrompt !== "function") {
      throw new PiCompatibilityError(
        `Pi ${version} does not expose compatible file-based HTML exporter internals under ${packageDir}. ` +
        "pi-share-slice will not fall back to Markdown or copy Pi's renderer.",
      );
    }

    const toolRenderer = await importFirst(packageDir, [
      "dist/core/export-html/tool-renderer.js",
      "src/core/export-html/tool-renderer.ts",
    ], exists, importer);
    const tools = await importFirst(packageDir, [
      "dist/core/tools/index.js",
      "src/core/tools/index.ts",
    ], exists, importer);

    return {
      exportSessionToHtml: exporter.exportSessionToHtml as ExportSessionToHtml,
      buildSystemPrompt: systemPrompt.buildSystemPrompt as BuildSystemPrompt,
      ...(typeof toolRenderer?.createToolHtmlRenderer === "function"
        ? { createToolHtmlRenderer: toolRenderer.createToolHtmlRenderer as CreateToolHtmlRenderer }
        : {}),
      ...(typeof tools?.createAllToolDefinitions === "function"
        ? { createAllToolDefinitions: tools.createAllToolDefinitions as CreateAllToolDefinitions }
        : {}),
    };
  } catch (error) {
    if (error instanceof PiCompatibilityError) throw error;
    throw new PiCompatibilityError(
      `Pi ${version} internal exporter could not be loaded from ${packageDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface HtmlPresentationState {
  systemPrompt?: string;
  tools?: Array<{ name: string; description: string; parameters: unknown }>;
}

export async function exportSlicedSessionToHtml(options: {
  sessionPath: string;
  outputPath: string;
  cwd: string;
  theme: Theme;
  presentation: HtmlPresentationState;
  internals?: PiInternalModules;
}): Promise<string> {
  const internals = options.internals ?? await loadPiInternals();
  const sessionManager = SessionManager.open(options.sessionPath);
  let toolRenderer: unknown;
  if (internals.createToolHtmlRenderer && internals.createAllToolDefinitions) {
    const definitions = internals.createAllToolDefinitions(options.cwd);
    toolRenderer = internals.createToolHtmlRenderer({
      cwd: options.cwd,
      theme: options.theme,
      getToolDefinition: (name) => definitions[name],
    });
  }

  return internals.exportSessionToHtml(
    sessionManager,
    options.presentation,
    {
      outputPath: options.outputPath,
      themeName: options.theme.name,
      ...(toolRenderer ? { toolRenderer } : {}),
    },
  );
}
