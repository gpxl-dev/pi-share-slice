import { describe, expect, test } from "bun:test";
import type { ExecResult } from "@earendil-works/pi-coding-agent";
import { createPrivateGist, GistShareError, parseGistUrl, type ExecCommand } from "./gist.ts";

const ok = (stdout = "", stderr = ""): ExecResult => ({ stdout, stderr, code: 0, killed: false });
const failed = (stderr: string): ExecResult => ({ stdout: "", stderr, code: 1, killed: false });

describe("secret/unlisted Gist sharing", () => {
  test("uses exact secret Gist arguments and builds viewer URLs", async () => {
    const calls: Array<[string, string[]]> = [];
    const exec: ExecCommand = async (command, args) => {
      calls.push([command, args]);
      return calls.length === 1 ? ok() : ok("https://gist.github.com/example/abc123\n");
    };
    const result = await createPrivateGist("/tmp/session.html", exec, {
      env: { PI_SHARE_VIEWER_URL: "https://share.example/session/" },
    });
    expect(calls).toEqual([
      ["gh", ["auth", "status"]],
      ["gh", ["gist", "create", "--public=false", "/tmp/session.html"]],
    ]);
    expect(result).toEqual({
      gistId: "abc123",
      gistUrl: "https://gist.github.com/example/abc123",
      viewerUrl: "https://share.example/session/#abc123",
    });
  });

  test("reports authentication and creation failures", async () => {
    await expect(createPrivateGist("file", async () => failed("not logged in"))).rejects.toThrow("gh auth login");
    let call = 0;
    await expect(createPrivateGist("file", async () => ++call === 1 ? ok() : failed("denied"))).rejects.toThrow(
      "Failed to create secret/unlisted Gist: denied",
    );
  });

  test("accepts only canonical GitHub Gist URLs", () => {
    expect(parseGistUrl("https://gist.github.com/example/abc123/?file=x")).toEqual({
      gistId: "abc123", gistUrl: "https://gist.github.com/example/abc123",
    });
    for (const output of [
      "not a url", "http://gist.github.com/example/abc123", "https://example.com/example/abc123",
      "https://gist.github.com/example/abc123/extra", "https://gist.github.com/example/not-a-hex-id",
    ]) expect(() => parseGistUrl(output)).toThrow(GistShareError);
  });

  test("uses process viewer configuration without an injected environment", async () => {
    const previous = process.env.PI_SHARE_VIEWER_URL;
    process.env.PI_SHARE_VIEWER_URL = "https://process.example/session/";
    let call = 0;
    try {
      const result = await createPrivateGist("file", async () => ++call === 1
        ? ok()
        : ok("https://gist.github.com/example/abc123"));
      expect(result.viewerUrl).toBe("https://process.example/session/#abc123");
    } finally {
      if (previous === undefined) delete process.env.PI_SHARE_VIEWER_URL;
      else process.env.PI_SHARE_VIEWER_URL = previous;
    }
  });

  test("distinguishes auth cancellation and timeout from uncertain upload interruption", async () => {
    const authController = new AbortController();
    const authExec: ExecCommand = async () => {
      authController.abort();
      return { ...ok(), killed: true };
    };
    try {
      await createPrivateGist("file", authExec, { signal: authController.signal });
      throw new Error("expected cancellation");
    } catch (error) {
      expect(error).toBeInstanceOf(GistShareError);
      expect((error as GistShareError).kind).toBe("cancelled");
      expect((error as Error).message).toContain("before upload");
    }

    try {
      await createPrivateGist("file", async () => ({ ...failed("timed out"), killed: true }));
      throw new Error("expected authentication timeout");
    } catch (error) {
      expect(error).toBeInstanceOf(GistShareError);
      expect((error as GistShareError).kind).toBe("failure");
      expect((error as Error).message).toContain("authentication check timed out");
    }

    const uploadController = new AbortController();
    let call = 0;
    const uploadExec: ExecCommand = async () => {
      if (++call === 1) return ok();
      uploadController.abort();
      return { ...ok(), code: 1, killed: true };
    };
    try {
      await createPrivateGist("file", uploadExec, { signal: uploadController.signal });
      throw new Error("expected uncertain state");
    } catch (error) {
      expect(error).toBeInstanceOf(GistShareError);
      expect((error as GistShareError).kind).toBe("uncertain");
      expect((error as Error).message).toContain("may still have created");
      expect((error as Error).message).toContain("gist.github.com/mine");
    }
  });

  test("returns a parseable Gist URL despite a late abort or killed flag", async () => {
    const controller = new AbortController();
    let call = 0;
    const result = await createPrivateGist("file", async () => {
      if (++call === 1) return ok();
      controller.abort();
      return { ...ok("https://gist.github.com/example/abc123"), killed: true };
    }, { signal: controller.signal, env: {} });
    expect(result.gistId).toBe("abc123");
  });
});
