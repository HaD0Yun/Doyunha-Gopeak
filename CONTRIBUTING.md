# Contributing to GoPeak

Thanks for contributing to GoPeak. This guide focuses on the current repository layout and the checks we expect before review.

## Before you start

- Search existing GitHub issues and pull requests before starting overlapping work.
- Prefer small, reviewable changes over broad rewrites.
- Keep user-visible behavior stable unless the change is explicitly intended to modify it.
- When touching packaging or installation flows, preserve the current opt-in shell-hook behavior (`gopeak setup`) and avoid silent shell rc mutations during `npm install`.

## Development setup

```bash
git clone https://github.com/HaD0Yun/Gopeak-godot-mcp.git
cd Gopeak-godot-mcp
bun ci
bun run build
```

Helpful commands:

```bash
bun run watch              # TypeScript watch mode
bun run inspector          # MCP inspector against build/index.js
bun run test:setup         # Shell-hook regression checks
```

## Repository map

```text
.
├── src/
│   ├── index.ts           # MCP server entrypoint / current main orchestration surface
│   ├── cli*.ts            # CLI entrypoint and setup/check/star helpers
│   ├── resources.ts       # MCP resources
│   ├── prompts.ts         # MCP prompts
│   ├── godot-bridge.ts    # Bridge transport and runtime integration
│   ├── providers/         # Asset provider integrations
│   └── visualizer/        # Browser visualizer assets
├── docs/                  # Architecture, roadmap, release docs
├── test-*.mjs             # Integration and regression coverage
├── server.json            # MCP registry metadata
└── package.json           # npm metadata and scripts
```

## Expected workflow

1. Make the smallest change that solves the problem.
2. Reuse existing helpers and naming patterns before introducing new abstractions.
3. Update docs when behavior, install flow, or capability claims change.
4. Keep `package.json`, `server.json`, README claims, and release notes aligned when metadata changes.

## Verification before PR

Run the repository checks that cover your area. For most feature or packaging changes, run all of these:

```bash
bun run ci
bun run test:dynamic-groups
bun run test:integration
bun run test:setup
```

If a command is not relevant or fails for an existing unrelated reason, call that out in the PR description with exact output.

For bridge transport, compact-profile, or tool-discovery changes, also include the targeted checks that cover those paths (typically `bun run test:dynamic-groups`, `bun run test:integration`, or the closest focused regression script).

## Capability changes

When adding or changing tools, resources, prompts, or CLI behavior:

- update the implementation and any related schema/metadata
- document the user-facing behavior in `README.md` and/or `docs/`
- keep compact/full profile behavior and aliases backward-compatible when possible
- add or update regression coverage near the affected area

## Documentation changes

Prefer repository-grounded documentation over aspirational notes.

- Use `docs/platform-roadmap.md` for active roadmap/planning material.
- Use `docs/architecture.md` for structural decisions and boundaries.
- Keep root-level summary docs (`README.md`, `ROADMAP.md`, `CONTRIBUTING.md`) aligned with the codebase instead of maintaining speculative feature backlogs.

## Pull requests

A good PR description includes:

- what changed
- why it changed
- verification commands and results
- any follow-up risks or compatibility notes
- any client refresh/reconnect caveats when the change affects dynamic tool exposure or bridge connectivity

Thanks again for helping improve GoPeak.
