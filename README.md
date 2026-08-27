# pi-share-slice

`pi-share-slice` is a dependency-free runtime extension for [Pi](https://pi.dev). It lets you select part of the active conversation branch and share it as a secret GitHub Gist through Pi's built-in HTML session viewer.

The extension does **not** convert sessions to Markdown or ship a copy of Pi's viewer. It calls the HTML exporter from the installed Pi package, so shared sessions keep Pi's normal theme, tree, message, thinking, and tool presentation.

## Requirements

- Pi with file-based package internals. The initial tested version is `@earendil-works/pi-coding-agent` 0.84.3.
- [GitHub CLI](https://cli.github.com/) installed and authenticated:

  ```bash
  gh auth login
  ```

- A terminal that reports modified keys for the Shift-selection shortcuts and `Ctrl+Shift+O`. Visual mode works when modified arrow keys are unavailable.

## Install

Install this checkout globally:

```bash
pi install /path/to/pi-share-slice
```

For development, load it for one run:

```bash
pi -e /path/to/pi-share-slice
```

After the repository is published, it can be installed as a Git Pi package:

```bash
pi install git:https://github.com/gpxl-dev/pi-share-slice
```

Use `/reload` after changing extension source. Pi packages run with your full user permissions; review extensions before installing them.

## Commands

- `/share-slice` opens the active-branch selector and then creates a secret Gist.
- `/share-slice-settings` changes and saves global selection defaults.

Pi 0.84.3 handles built-in commands before extension command dispatch. An extension cannot replace the built-in `/share`, so this package intentionally uses `/share-slice`.

## Selector

Rows are split into user messages, assistant text, assistant reasoning, and one bundle for each tool call plus its result. The initial `user-assistant-only` filter shows only user messages and assistant text. Those rows start selected. Reasoning, tools, context rows, and system context start unselected.

Search is a case-insensitive literal substring match. Filtering never clears selections that are hidden from the current view.

| Key | Action |
| --- | --- |
| `↑` / `↓`, `j` / `k` | Move one row |
| `PgUp` / `PgDn` | Move one page |
| `Space` | Toggle one row, or add the visual range |
| `/` | Edit the search query |
| `Esc` / `Ctrl+C` | Leave search, clear search, then cancel |
| `v` | Enter or leave visual mode |
| `G` | Move to the last visible row; extends the visual range |
| `Ctrl+D` in visual mode | Move down half a page |
| `Shift+↑` / `Shift+↓` | Extend and select a range |
| `Shift+PgUp` / `Shift+PgDn` | Extend and select by a page |
| `Shift+Home` / `Shift+End` | Extend and select to the start or end |
| `a` | Select all visible rows |
| `n` | Select no visible rows |
| `C` | Clear the complete selection, including hidden rows |
| `T` | Remove all tool bundles from the selection |
| `s` | Cycle system context: none, without tools, with tools |
| `Enter` | Export and share the selection |

The selector also follows Pi's tree filter bindings:

| Key | Filter |
| --- | --- |
| `Ctrl+D` | Default |
| `Ctrl+T` | No tools |
| `Ctrl+U` | User only |
| `Ctrl+L` | Labeled only |
| `Ctrl+A` | All rows |
| `Ctrl+O` / `Ctrl+Shift+O` | Cycle forward / backward |

`user-assistant-only` has no dedicated Pi tree binding. It is the initial filter and is available through filter cycling or `/share-slice-settings`. `Ctrl+D` switches to Pi's broader default filter and performs its visual-mode movement first when visual mode is active.

## Global configuration

Configuration lives at `~/.pi/agent/pi-share-slice.json`. The path follows Pi's configured agent directory, including `PI_CODING_AGENT_DIR` overrides. The command reloads this file each time, so hand edits do not require `/reload`.

```json
{
  "defaults": {
    "user": true,
    "assistant": true,
    "reasoning": false,
    "tool": false,
    "context": false,
    "systemContext": "none",
    "filterMode": "user-assistant-only"
  }
}
```

Invalid fields fall back independently and produce a warning.

### System context modes

- `none`: omit both the system prompt and tool definitions. This is the default.
- `without-tools`: rebuild Pi's system context with no selected tools, snippets, or tool-specific guidelines. Project context and other prompt content remain.
- `with-tools`: include the current effective system prompt and metadata for active tools.

System prompts, project instructions, tool schemas, reasoning, and tool output can contain sensitive information. Review the visible mode and selected rows before sharing.

The filtered snapshot uses a synthetic session header with a neutral working directory. It also omits hidden provider diagnostics, extension-only details, retained compaction tails, and custom persistence data. Selected edit-tool bundles retain their visible diff so Pi can render it normally.

## Sharing and privacy

The extension runs:

```bash
gh gist create --public=false session.html
```

GitHub calls these Gists secret or unlisted. They are **not access-controlled private storage**: anyone with the URL can read them. Pi's viewer URL points to the same Gist. `PI_SHARE_VIEWER_URL` is honored in the same form as Pi's built-in share command.

No share history is stored by this extension in tranche 1. If you cancel while `gh gist create` is running, the extension waits for the process to stop before deleting temporary files. GitHub can still create the Gist during that race. When the remote state is uncertain, the error directs you to check your Gists before retrying.

## Compatibility and limitations

Pi currently exposes session reading to extensions but does not publicly export the arbitrary-session HTML generator or system-prompt builder. `pi-share-slice` therefore uses a small capability-checked adapter that derives absolute internal module paths from Pi's public `getPackageDir()` API. It loads Pi's implementation at runtime and fails clearly if the required functions are unavailable. It never falls back to Markdown or a copied viewer.

This adapter may need an update after Pi changes its internal file layout or function signatures. A compiled standalone Pi binary may not provide importable files and is not currently supported.

The adapter can load Pi's built-in tool definitions for HTML rendering. Pi's public extension API does not expose renderer functions owned by other extensions, so selected custom tools may use Pi's generic HTML fallback instead of their custom TUI renderer.

Alternative share backends and expiry, share history/deletion, and extension-specific theme customization are deferred to later tranches.

## Development

Runtime code has no third-party dependencies. Pi packages are peers; TypeScript and Bun test packages are development-only.

```bash
bun install --minimum-release-age=0  # only needed when a local Bun policy blocks a fresh Pi release
bun run typecheck
bun test
bun run check
```

The exporter integration test is local-only. It decodes Pi's embedded session data to verify omitted messages, reasoning, tool calls, and results are absent. Tests never create a Gist.

## License

MIT
