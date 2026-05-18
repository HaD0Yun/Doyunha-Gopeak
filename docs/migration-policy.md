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

## Verification commands

Run the relevant checks before publishing a migration claim:

```bash
npm run build
npm run typecheck
npm run test:dynamic-groups
npm run test:metadata
npm run test:packaging
```

For capability changes, also verify the affected MCP path with a compact-profile `tools/list` and `tools/call` smoke. For package/docs claim changes, run `npm run test:docs` and the metadata/packaging checks.
