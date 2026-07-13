# Migration and Deprecation Policy

GoPeak preserves real Godot workflows while reducing misleading or environment-dependent MCP surface area. Use this policy for any change that hides, removes, renames, quarantines, or changes the API contract of a tool, resource, prompt, profile, or package/docs claim.

## Exposure profiles

| Profile / layer | Purpose | Compatibility rule |
|---|---|---|
| `compact` | Default trusted workflow surface with dynamic discovery. | Keep stable aliases and only expose setup-gated capabilities when the user activates/discovers them. |
| Dynamic groups | Capability families activated by `tool.catalog` or `tool.groups`. | Label groups as trusted, audit-required, optional-runtime, optional-lsp, optional-dap, optional-network, or workflow-layer. |
| `full` | Full legacy tool list for compatibility and audit work. | Do not remove names without an old → new mapping and release-note entry. |
| `legacy` | Alias for `full` for older configs. | Preserve behavior until a major-version removal plan exists. |

## Required row for every breaking or exposure change

Every hide/remove/rename/API-contract change must be tracked with this row shape in the audit or release notes:

| Field | Required content |
|---|---|
| Old surface | Existing tool/resource/prompt/profile/claim name. |
| New surface | Replacement name, profile, resource/prompt, or `none`. |
| Change type | `hide`, `remove`, `rename`, `alias`, `contract-change`, or `docs-claim-change`. |
| Profile impact | `compact`, `dynamic:<group>`, `full`, `legacy`, package metadata, or docs-only. |
| Alias window | Whether the old name remains and for how long. |
| User workflow impact | Common prompt/workflow that changes. |
| Docs location | README/docs/release note that explains the migration. |
| Verification | Command proving `tools/list`, alias, schema, or package/docs behavior. |

## Current audit policy

- Do not market raw tool count as the primary value. Use trusted Godot 4 workflow language instead.
- Treat `compact` as the safe default; treat `full`/`legacy` as compatibility and audit profiles.
- Keep legacy tool names and compact aliases unless a documented major-version migration removes them.
- Keep optional external surfaces setup-gated:
  - `runtime` and `testing` require runtime addon/socket/editor bridge availability.
  - `lsp` requires Godot LSP on port `6005`.
  - `dap` requires Godot DAP on port `6006`.
  - `asset_store` requires network/provider availability.
- Treat `intent_tracking` as a workflow layer, not a Godot engine primitive.
- Require Godot 4 fixture evidence before promoting scene/resource/project-setting/tilemap mutation groups from audit-required to trusted.

## Bun distribution migration

The current CLI is a bundled runtime distributed as a versioned GitHub Release asset. It is not published to the npm registry, does not require registry credentials, and does not contact the npm registry while installing or running. Bun installs the already-built archive; it does not resolve runtime packages during installation.

The previous source-checkout installer flags remain accepted with a deprecation warning throughout the `2.3.x` line. The new installer installs one verified global CLI rather than maintaining a source checkout. Compatibility configuration is printed to the terminal and never written to client files. The flags are planned for removal in `3.0.0`.

| Old surface | New surface | Change type | Profile impact | Alias window | User workflow impact | Docs location | Verification |
|---|---|---|---|---|---|---|---|
| `--dir PATH` | Bun's global install location; set `BUN_INSTALL` before installation only when a custom Bun home is required. | `contract-change` | package metadata | Accepted with a warning in `2.3.x`; remove in `3.0.0`. | The installer no longer clones or updates a repository at `PATH`. | `README.md`, this section | `./install.sh --dir /tmp/legacy --help` reports the replacement without creating `/tmp/legacy`. |
| `--godot PATH` | Put `GODOT_PATH` in the MCP client's `env` block. | `contract-change` | docs-only | Accepted with a warning in `2.3.x`; remove in `3.0.0`. | During `2.3.x`, the supplied path appears as `GODOT_PATH` in compatibility configuration output; the installer does not persist it. | `README.md` MCP config example | `./install.sh --godot /path/to/godot --configure claude` prints `GODOT_PATH` and writes no client file. |
| `--configure NAME` | Use the client configuration example in `README.md` with `command: "gopeak"`. | `contract-change` | docs-only | Accepted with a warning and terminal-only config output in `2.3.x`; remove in `3.0.0`. | Supported client snippets remain printable during the window, but configuration stays user-managed. | `README.md` MCP config example | `./install.sh --configure claude` prints the supported snippet and writes no client file. |

The checksum and provenance attestation protect different boundaries. SHA-256 detects a changed download. GitHub's artifact attestation identifies the repository and workflow that produced the archive. The supported installer checks SHA-256 before changing the global installation; release reviewers can additionally verify the attestation with the command in `docs/release-process.md`.

## Verification commands

Run the relevant checks before publishing a migration claim:

```bash
bun run build
bun run typecheck
bun run test:dynamic-groups
bun run test:metadata
bun run test:packaging
```

For capability changes, also verify the affected MCP path with a compact-profile `tools/list` and `tools/call` smoke. For package/docs claim changes, run `bun run test:docs` and the metadata/packaging checks.
