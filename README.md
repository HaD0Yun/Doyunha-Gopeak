# GoPeak

[![](https://badge.mcpx.dev?type=server 'MCP Server')](https://modelcontextprotocol.io/introduction)
[![Made with Godot](https://img.shields.io/badge/Made%20with-Godot-478CBF?style=flat&logo=godot%20engine&logoColor=white)](https://godotengine.org)
[![](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white 'Node.js')](https://nodejs.org/en/download/)
[![npm](https://img.shields.io/npm/v/gopeak?style=flat&logo=npm&logoColor=white 'npm')](https://www.npmjs.com/package/gopeak)
[![](https://img.shields.io/badge/License-MIT-red.svg 'MIT License')](https://opensource.org/licenses/MIT)

🌐 **Languages**: **English** | [한국어](README-ko.md) | [日本語](README-ja.md) | [Deutsch](README-de.md) | [Português](README-pt_BR.md) | [简体中文](README-zh.md)

![GoPeak Hero](assets/gopeak-hero-v2.png)

**GoPeak is an MCP server for Godot 4 that gives AI assistants a real edit → run → inspect → fix loop.**

It is designed for trusted Godot 4 workflows: small default tool surface, setup-gated advanced capabilities, and explicit compatibility rules for older/legacy tool names.

> English is the canonical source of truth. Localized READMEs are concise overviews and may lag behind `README.md`.
>
> Discord is temporarily unavailable while the invite link is refreshed. Use [GitHub Discussions](https://github.com/HaD0Yun/Gopeak-godot-mcp/discussions) for now.

---

## Quick Start

### Requirements

- Godot 4.x
- Node.js 18+
- MCP-compatible client such as Claude Desktop, Cursor, Cline, or OpenCode

### 1) Run GoPeak

```bash
npx -y gopeak
```

or install globally:

```bash
npm install -g gopeak
gopeak
```

### 2) Add MCP client config

```json
{
  "mcpServers": {
    "godot": {
      "command": "npx",
      "args": ["-y", "gopeak"],
      "env": {
        "GODOT_PATH": "/path/to/godot",
        "GOPEAK_TOOL_PROFILE": "compact"
      }
    }
  }
}
```

`compact` is the default profile. It keeps the initial MCP context small and exposes additional setup-gated groups only when requested.

### 3) Try these prompts

- "List Godot projects in `/your/projects` and show project info."
- "Create `scenes/Player.tscn` with a `CharacterBody2D` root and a movement script."
- "Run the project, read the debug output, and fix the top error."
- "Use `tool.catalog` to find animation tools, then activate the right group."

---

## What You Get

| Workflow | What GoPeak can do |
|---|---|
| Project control | Find projects, launch the editor, run/stop the game, collect debug output. |
| Scene + script editing | Create scenes, add nodes, edit typed properties, create/modify GDScript. |
| Resource workflows | Work with resources, materials, shaders, imports, and export-related checks. |
| Debugging | Use logs, Godot LSP diagnostics, DAP breakpoints/stack traces, and runtime inspection when configured. |
| Runtime testing | Capture screenshots, inspect live trees, inject input, and call runtime methods through the addon. |
| Tool discovery | Keep the default surface compact, then activate capability groups with `tool.catalog` or `tool.groups`. |

### Setup gates

Some capabilities require extra Godot-side services. GoPeak labels these instead of pretending everything is always available:

| Capability | Requires |
|---|---|
| Editor bridge scene/resource edits | `godot_mcp_editor` plugin enabled in the Godot project. |
| Runtime inspection, screenshots, input injection | Runtime addon/socket, default port `7777`. |
| GDScript LSP tools | Godot LSP enabled on port `6005`. |
| DAP debugging tools | Godot DAP enabled on port `6006`. |
| Asset store/provider tools | Network access and provider availability. |

---

## Add the Godot Plugins

Install from your Godot project folder:

```bash
curl -sL https://raw.githubusercontent.com/HaD0Yun/Gopeak-godot-mcp/main/install-addon.sh | bash
```

PowerShell:

```powershell
iwr https://raw.githubusercontent.com/HaD0Yun/Gopeak-godot-mcp/main/install-addon.ps1 -UseBasicParsing | iex
```

Then enable plugins in **Project Settings → Plugins**:

- `godot_mcp_editor` for bridge-backed scene/resource tools
- `godot_mcp_runtime` for runtime inspection, screenshots, and input workflows

Optional shell hooks for update notifications are opt-in:

```bash
gopeak setup
```

`gopeak setup` only modifies supported bash/zsh rc files when you run it explicitly. `npm install` does not install shell hooks automatically.

---

## Tool Profiles

GoPeak supports three exposure profiles:

| Profile | Use when |
|---|---|
| `compact` | Default. Trusted core tools plus dynamic groups activated on demand. |
| `full` | Compatibility/audit mode for the full legacy surface. |
| `legacy` | Older config alias with the same exposed behavior as `full`. |

Set either `GOPEAK_TOOL_PROFILE` or the fallback alias `MCP_TOOL_PROFILE`.

### Dynamic groups

In compact mode, search with `tool.catalog`; matching groups auto-activate. You can also manage groups directly with `tool.groups`.

Common groups:

| Group | Status | Notes |
|---|---|---|
| `runtime` | optional-runtime | Live scene tree, properties, method calls, metrics. Requires runtime addon/socket. |
| `testing` | optional-runtime | Screenshots, viewport capture, input injection. Requires runtime/editor setup. |
| `lsp` | optional-lsp | Diagnostics, completion, hover, symbols. Requires Godot LSP on port `6005`. |
| `dap` | optional-dap | Breakpoints, stepping, stack traces. Requires Godot DAP on port `6006`. |
| `asset_store` | optional-network | External CC0 asset search/download. Network/provider dependent. |
| `class_advanced` | trusted-static | ClassDB/inheritance discovery backed by static engine metadata. |
| `tilemap` | audit-required | Must account for Godot 4.3+ `TileMapLayer` behavior before promotion. |
| mutation groups | audit-required | Scene/resource/script/settings/signal/autoload/import/audio/navigation/theme/animation groups need fixture evidence before being marketed as fully trusted. |
| `intent_tracking` | workflow-layer | Workflow memory/handoff helpers, not a Godot engine primitive. Keep opt-in. |

If your MCP client does not refresh after activation, reconnect the client or call the newly activated tool once to force a fresh `tools/list` round-trip.

GoPeak also uses cursor-based pagination for `tools/list` so large profiles are not dumped into context at once. Tune it with `GOPEAK_TOOLS_PAGE_SIZE` when needed.

---

## Typed Godot Values

Bridge-backed scene tools such as `add_node` and `set_node_properties` accept common vector payloads for typed properties:

```json
{
  "position": { "type": "Vector2", "x": 100, "y": 200 },
  "scale": { "type": "Vector2", "x": 2, "y": 2 }
}
```

Plain `{ "x": 100, "y": 200 }` and `[100, 200]` are also coerced for common `Vector2` fields, but tagged values are safest across tools.

---

## Useful Commands

```bash
# run from npm
npx -y gopeak

# install globally
npm install -g gopeak

# run from source
git clone https://github.com/HaD0Yun/Gopeak-godot-mcp.git
cd Gopeak-godot-mcp
npm install
npm run build
node build/index.js

# local verification
npm run ci
npm run test:dynamic-groups
npm run test:metadata
npm run test:packaging
```

CLI bin names:

- `gopeak`
- `godot-mcp`

---

## Environment & Ports

| Name | Purpose | Default |
|---|---|---|
| `GOPEAK_TOOL_PROFILE` | Tool exposure profile: `compact`, `full`, `legacy` | `compact` |
| `MCP_TOOL_PROFILE` | Fallback profile env alias | `compact` |
| `GODOT_PATH` | Explicit Godot executable path | auto-detect |
| `GODOT_BRIDGE_PORT` | Bridge/Visualizer HTTP+WS port override | `6505` |
| `GOPEAK_BRIDGE_HOST` | Bridge/Visualizer bind host | `127.0.0.1` |
| `GOPEAK_TOOLS_PAGE_SIZE` | Number of tools per `tools/list` page | `33` |
| `GOPEAK_RUNTIME_TIMEOUT_MS` | Runtime addon command timeout in milliseconds | `10000` |
| `DEBUG` | Enable server debug logs | `false` |
| `LOG_MODE` | Recording mode: `lite` or `full` | `lite` |

| Port | Service |
|---|---|
| `6505` | Unified Godot Bridge + Visualizer server on loopback by default. |
| `6005` | Godot LSP. |
| `6006` | Godot DAP. |
| `7777` | Runtime addon command socket. |

Runtime screenshot tools (`capture_screenshot`, `capture_viewport`) use a GoPeak-managed temporary PNG file when the runtime addon supports `output_path`, then return normal MCP image content. Older runtime addons that do not receive an `output_path` continue to return inline base64 screenshots.

---

## Troubleshooting

- **Godot not found** → set `GODOT_PATH`.
- **No MCP tools visible** → restart your MCP client.
- **Need a hidden tool** → search with `tool.catalog` or activate a group with `tool.groups`.
- **Project path invalid** → confirm `project.godot` exists.
- **Runtime tools not working** → install/enable the runtime addon and check port `7777`.
- **Runtime screenshots time out** → update the runtime addon so screenshot commands support the managed `output_path` flow. For slow runtime responses, raise `GOPEAK_RUNTIME_TIMEOUT_MS`; older addons may still time out on large inline base64 screenshots.
- **Editor bridge disconnected** → stop duplicate `gopeak`/MCP servers that may already own bridge port `6505`; `get_editor_status` reports bridge startup errors such as `EADDRINUSE`.

---

## Migration & Deprecation Policy

GoPeak treats `compact` as the safe default and `full`/`legacy` as compatibility profiles. Future hide, remove, rename, or API-contract changes must include:

1. old → new mapping or an explicit no-replacement note;
2. profile impact (`compact`, `full`, `legacy`, or opt-in group);
3. alias window and planned removal timing;
4. README/docs and release-note updates;
5. verification proving `tools/list` exposure and alias behavior;
6. migration prompt examples for common Godot workflows.

Current stance: legacy tool names and compact aliases remain supported. Optional external groups (`runtime`, `testing`, `lsp`, `dap`, `asset_store`) are setup-gated, not always-available core behavior.

Full policy: [docs/migration-policy.md](docs/migration-policy.md).

---

## More Docs

- [Documentation Map](docs/README.md)
- [Architecture](docs/architecture.md)
- [Migration Policy](docs/migration-policy.md)
- [Release Process](docs/release-process.md)
- [CHANGELOG](CHANGELOG.md)
- [ROADMAP](ROADMAP.md)
- [CONTRIBUTING](CONTRIBUTING.md)

---

## License & Credits

MIT — see [LICENSE](LICENSE).

- Original MCP server by [Coding-Solo](https://github.com/Coding-Solo/godot-mcp)
- GoPeak enhancements by [HaD0Yun](https://github.com/HaD0Yun)
- Project visualizer inspired by [tomyud1/godot-mcp](https://github.com/tomyud1/godot-mcp)
