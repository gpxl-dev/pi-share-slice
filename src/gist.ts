import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";

export type ExecCommand = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

export type GistShareErrorKind = "failure" | "cancelled" | "uncertain";

export class GistShareError extends Error {
  constructor(message: string, readonly kind: GistShareErrorKind = "failure") {
    super(message);
    this.name = "GistShareError";
  }
}

export interface GistShareResult {
  gistId: string;
  gistUrl: string;
  viewerUrl: string;
}

export function parseGistUrl(output: string): { gistId: string; gistUrl: string } {
  const candidates = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const candidate of [...candidates].reverse()) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    const [owner, gistId] = parts;
    if (
      parsed.protocol !== "https:" || parsed.hostname !== "gist.github.com" || parts.length !== 2 ||
      !owner || !/^[A-Za-z0-9-]+$/.test(owner) || !gistId || !/^[A-Fa-f0-9]+$/.test(gistId)
    ) continue;
    return { gistId, gistUrl: `https://gist.github.com/${owner}/${gistId}` };
  }
  throw new GistShareError("GitHub CLI did not return a valid gist.github.com Gist URL.");
}

function commandFailure(prefix: string, result: ExecResult): GistShareError {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
  return new GistShareError(`${prefix}: ${detail}`);
}

export async function createPrivateGist(
  htmlPath: string,
  exec: ExecCommand,
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<GistShareResult> {
  const execOptions = { signal: options.signal, timeout: 30_000 };
  const auth = await exec("gh", ["auth", "status"], execOptions);
  if (options.signal?.aborted) throw new GistShareError("Share cancelled before upload.", "cancelled");
  if (auth.killed) throw commandFailure("GitHub CLI authentication check timed out", auth);
  if (auth.code !== 0) {
    throw commandFailure("GitHub CLI is unavailable or not logged in; install gh and run 'gh auth login'", auth);
  }

  const result = await exec("gh", ["gist", "create", "--public=false", htmlPath], {
    signal: options.signal,
    timeout: 120_000,
  });

  let parsed: { gistId: string; gistUrl: string } | undefined;
  try {
    parsed = parseGistUrl(result.stdout);
  } catch {
    // A failed or interrupted process commonly has no URL. Handle its state below.
  }
  if (parsed) {
    const viewerBase = options.env?.PI_SHARE_VIEWER_URL || process.env.PI_SHARE_VIEWER_URL || "https://pi.dev/session/";
    return { ...parsed, viewerUrl: `${viewerBase}#${parsed.gistId}` };
  }
  if (options.signal?.aborted || result.killed) {
    throw new GistShareError(
      "Secret/unlisted Gist upload was interrupted. GitHub may still have created it; check https://gist.github.com/mine before retrying.",
      "uncertain",
    );
  }
  if (result.code !== 0) throw commandFailure("Failed to create secret/unlisted Gist", result);

  const { gistId, gistUrl } = parseGistUrl(result.stdout);
  const viewerBase = options.env?.PI_SHARE_VIEWER_URL || process.env.PI_SHARE_VIEWER_URL || "https://pi.dev/session/";
  return { gistId, gistUrl, viewerUrl: `${viewerBase}#${gistId}` };
}
