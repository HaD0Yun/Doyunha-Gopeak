# Plan: AI-Build / AI-Run Closed-Loop Capabilities

## 1. Goal

Enable a **fully autonomous build → run → observe → fix loop** for an AI
agent driving GoPeak. Today GoPeak gives the AI plenty of *primitives*
(scene/script edit, run, capture screenshot, inject input) but is missing
the **closed-loop layer** that turns those primitives into an unattended
cycle:

- **AI Build leg** — high-level scaffolding (3D, physics, particles,
  animation tree, cross-scene refactoring, code analysis) so the AI can
  compose non-trivial scenes without thousands of low-level node edits.
- **AI Run leg** — test scenario runner, runtime assertions, frame-precise
  input record/replay, sync primitives (`wait_for_node`, `monitor_properties`),
  semantic UI (`click_button_by_text`), vision diff (`compare_screenshots`),
  and profiling — so the AI can execute a play-test, *check the result
  itself*, and decide whether to iterate.

This plan is scoped to capabilities GoPeak does not yet expose. It is
**not** a rewrite — it complements GoPeak's existing strengths (LSP, DAP,
dynamic groups, intent tracking, visualizer, asset library).

## 2. Gap Inventory

Cross-referenced against `src/tool-definitions.ts` (100 tools).

### 2A. AI Run — autonomy primitives (highest leverage)

| Tool | Purpose | GoPeak status |
|---|---|---|
| `run_test_scenario` | Scripted sequence of inputs + assertions | **missing** |
| `assert_node_state` | Pass/fail on runtime node property | **missing** |
| `assert_screen_text` | Pass/fail on rendered text via OCR or label scan | **missing** |
| `run_stress_test` | Random input fuzzing | **missing** |
| `get_test_report` | Aggregate pass/fail/log output | **missing** |
| `start_recording` / `stop_recording` / `replay_recording` | Frame-accurate input capture & replay | **missing** |
| `wait_for_node` | Block until node exists/ready | **missing** |
| `monitor_properties` | Stream property changes over time window | **missing** |
| `batch_get_properties` | One round-trip for many nodes | **missing** |
| `find_ui_elements` | Discover buttons/labels at runtime | **missing** |
| `click_button_by_text` | Semantic UI interaction (no coords) | **missing** |
| `compare_screenshots` | Pixel/percep diff between two captures | **missing** |
| `get_editor_screenshot` | Capture editor (not just game) viewport | **missing** (only `capture_screenshot` for game) |
| `capture_frames` | Multi-frame burst capture | **missing** |
| `get_performance_monitors` | Runtime FPS/memory/draw-call series | partially via `get_runtime_metrics`; needs named monitors |
| `get_editor_performance` | Editor-side perf | **missing** |

### 2B. AI Build — scaffolding (medium leverage)

| Group | GoPeak status |
|---|---|
| **3D Scene** — `add_mesh_instance`, `setup_lighting`, `setup_environment`, `setup_camera_3d`, `set_material_3d`, `add_gridmap` | missing as group; partial via raw `add_node` |
| **Physics** — `setup_collision`, `setup_physics_body`, `add_raycast`, `set_physics_layers`, `get_physics_layers`, `get_collision_info` | missing |
| **Particles** — `create_particles`, `set_particle_material`, `set_particle_color_gradient`, `apply_particle_preset`, `get_particle_info` | missing |
| **AnimationTree advanced** — state-machine `add/remove_state` and `add/remove_transition`, `set_blend_tree_node`, `set_tree_parameter`, `get_animation_tree_structure` | partial (`create_animation_tree`, `add_animation_state`, `connect_animation_states`); blend-tree + parameters missing |
| **Cross-scene refactor** — `cross_scene_set_property`, `find_node_references`, `find_signal_connections`, `find_nodes_by_type`, `batch_set_property`, `get_scene_dependencies` | missing (only `find_resource_usages`, `get_dependencies`) |
| **Code analysis** — `find_unused_resources`, `analyze_signal_flow`, `analyze_scene_complexity`, `find_script_references`, `detect_circular_dependencies`, `get_project_statistics` | missing |
| **Resource generic** — `read_resource`, `edit_resource` | partial (`create_resource`, `modify_resource`); no read |
| **Editor utilities** — `execute_editor_script`, `clear_output`, `reload_plugin`, `reload_project` | missing |
| **Node ergonomics** — `move_node`, `rename_node`, `set_anchor_preset` | missing (`reparent_node` ≠ `move_node` for ordered children; rename absent) |

### 2C. Out of scope for this plan

- LSP/DAP — already in place.
- Asset library — already in place (Poly Haven, AmbientCG, Kenney).
- Visualizer — already in place.
- Tool-list pagination & dynamic groups — already in place.
- Intent tracking / handoff — already in place.
- Project export — `list_export_presets`, `export_project`, `validate_project`
  already in place.

## 3. Phased Delivery

Phases are ordered by leverage on the autonomous loop. Phase 1 alone
unlocks closed-loop AI play-testing; later phases broaden what the AI can
build before testing.

### Phase 1 — AI Run closed loop (the unlock)  **[DONE]**

Goal: AI can write `run_test_scenario`, the server runs it, the AI gets a
pass/fail report — without a human watching.

**New tools:**
- [x] `wait_for_node(path, timeout_ms)`
- [x] `monitor_properties(node_paths, properties, duration_ms, sample_hz)`
- [x] `batch_get_properties(targets[])`
- [x] `find_ui_elements(filter)` and `click_button_by_text(text, exact?)`
- [x] `assert_node_state(path, expectations[])` — equality, range, regex,
  `exists`/`!exists`
- [x] `assert_screen_text(text, region?)` — label-tree scan; OCR optional
  behind a flag
- [x] `compare_screenshots(a, b, tolerance, region?)` — perceptual hash + SSIM
- [x] `capture_frames(count, interval_ms)` and `get_editor_screenshot()`
- [x] `start_recording(name)` / `stop_recording()` / `replay_recording(name, speed?)`
- [x] `run_test_scenario(scenario)` — scenario = `{ setup, steps[], asserts[],
  teardown }`; steps reuse existing `inject_*` plus the new sync/assertion
  primitives
- [x] `run_stress_test(seed, duration_ms, action_set?)`
- [x] `get_test_report(run_id?)`
- [x] `get_performance_monitors(names[])` extending the existing
  `get_runtime_metrics`

**Where it lives:**
- [x] TS surface: new `src/tools/runtime_test.ts` module exporting handlers;
  schemas registered in `src/tool-definitions.ts`.
- [x] New tool group `runtime_test` in `src/tool-groups.ts` plus expansion of
  the existing `testing` group keyword list (`assert`, `wait`, `monitor`,
  `record`, `replay`, `scenario`, `stress`, `compare screenshots`).
- [x] Runtime side: extend `src/addon/godot_mcp_runtime/` to handle new socket
  commands. Recording = capture `Input.parse_input_event` stream with
  frame index from `Engine.get_process_frames()`. Replay = inject events
  on matching frame counter.
- [x] Screenshot diff: pure-Node implementation in `src/tools/image_diff.ts`
  (no native deps — pHash + per-tile mean diff is enough; SSIM optional
  and lazy-loaded).
- [x] Test report: persist to `<project>/.gopeak/test-runs/<id>.json`; expose
  via existing MCP resources (`src/resources.ts`) so clients can browse
  past runs without an extra tool call.

**Acceptance:**
- [x] Smoke test in `test-e2e-dynamic-groups.mjs` plus a new
  `test-runtime-loop.mjs` that drives a sample project: `wait_for_node` →
  inject sequence → assert state + screen text → capture report. Passes
  headless in CI.

### Phase 2 — AI Build scaffolding (3D / Physics / Particles)  **[DONE]**

Goal: AI can stand up a playable 3D test bed in a handful of tool calls
instead of dozens of `add_node` + `set_node_properties` calls.

**New tools:**

- 3D group:
  - [x] scaffolding (schemas, group, GD module skeleton, executor wiring,
    TS dispatch) — Task A1
  - [x] `add_mesh_instance` — Task A2
  - [x] `setup_camera_3d` — Task A3
  - [x] `setup_lighting` — Task A4
  - [x] `setup_environment` — Task A5
  - [x] `set_material_3d` — Task A6
  - [x] `add_gridmap` — Task A7
  - [x] smoke test `test-build-scaffolding.mjs` (scene_3d coverage) — Task A8

- Physics group:
  - [x] scaffolding — Task B1
  - [x] `setup_collision` — Task B2
  - [x] `setup_physics_body` — Task B3
  - [x] `add_raycast` — Task B4
  - [x] `set_physics_layers` — Task B5
  - [x] `get_physics_layers` — Task B6
  - [x] `get_collision_info` — Task B7
  - [x] smoke test (scene_physics coverage) — Task B8

- Particles group:
  - [x] scaffolding — Task C1
  - [x] `create_particles` — Task C2
  - [x] `set_particle_material` — Task C3
  - [x] `set_particle_color_gradient` — Task C4
  - [x] `apply_particle_preset` — Task C5
  - [x] `get_particle_info` — Task C6
  - [x] smoke test (scene_particles coverage) — Task C7

**Where it lives:**
- [x] Bridge-backed scene edits via `src/addon/godot_mcp_editor/tools/scene_3d_tools.gd`
  (created in A1) — physics and particles modules to follow.
- Direct dispatch from `src/index.ts` to `handleViaBridge`; no separate TS
  handler module needed (deviates from original plan, matches Phase 1's
  pattern for purely bridge-backed tools like `create_resource`).
- [x] New tool group `scene_3d` registered in `src/tool-groups.ts`
  (`scene_physics` and `scene_particles` groups still pending).
- Reuse the typed-property coercion already in place
  (`Vector2`/`Vector3` tagged values) — no schema churn needed.

### Phase 2b — AI Build scaffolding (2D)  **[DONE]**

Goal: give GoPeak a first-class `scene_2d` group. Today 2D composition
relies on raw `add_node` with `Node2D`/`Control` classes; a dedicated
2D scaffolding surface lets the AI compose platformers, top-downs, and
UI prototypes in a few calls instead of dozens.

**Gap analysis:**

| Capability | GoPeak |
|---|---|
| Sprite texture assign | `load_sprite` (existing) |
| TileMap / TileSet | `create_tileset`, `set_tilemap_cells` |
| 2D physics shortcut | raw `add_node` |
| Camera2D / parallax / canvas layer | — |
| 2D character/area body scaffold | — |

**New tools:**
- [x] `add_sprite_2d(parent, name, texture, position?, region?, frames?)` —
  one-call sprite with texture assignment (today: `add_node` Sprite2D
  + `set_node_properties` + `load_sprite`).
- [x] `setup_camera_2d(parent, name, target_path?, zoom?, limits?, smoothing?)`
  — Camera2D with optional follow target and bounds.
- [x] `add_canvas_layer(parent, name, layer_index?, follow_viewport?)` —
  HUD / overlay scaffolding.
- [x] `setup_parallax_background(parent, layers[])` — `ParallaxBackground` +
  `ParallaxLayer` + sprite per layer with motion scale, in one call.
- [x] `add_area_2d(parent, name, shape, size, layers?, monitorable?)` —
  Area2D + CollisionShape2D + Shape2D resource, wired together.
- [x] `setup_character_body_2d(parent, name, shape, size, sprite?, script?)`
  — CharacterBody2D + CollisionShape2D + optional Sprite2D + optional
  movement script template (`platformer`, `top_down`, `none`).
- [x] `setup_static_body_2d(parent, name, shape, size, layers?)` — same for
  static geometry.
- [x] `add_y_sort_container(parent, name)` — top-down z-ordering helper.
- [x] `set_node_2d_transform(path, position?, rotation?, scale?)` — typed
  Vector2 ergonomics shortcut over `set_node_properties`.
- [x] `add_path_2d(parent, name, points[], closed?)` — Path2D + Curve2D in
  one call (useful for follow paths).

**Where it lives:**
- [x] Bridge-backed via `src/addon/godot_mcp_editor/tools/scene_2d_tools.gd`
  — implements all 10 tools with composite node tree building so undo in
  the editor is one step.
- [x] Direct dispatch from `src/index.ts` to `handleViaBridge`; follows the
  same pattern as Phase 2's bridge-backed tools.
- [x] New tool group `scene_2d` in `src/tool-groups.ts` with keywords:
  `2d scene`, `sprite`, `camera 2d`, `parallax`, `canvas layer`,
  `character body 2d`, `area 2d`, `platformer`, `top down`, `hud`,
  `y sort`, `path 2d`.
- [x] Movement script templates (`platformer`, `top_down`) are generated
  inline by `setup_character_body_2d` using the same template pattern as
  `scaffold_gameplay_prototype`.
- [x] Reuse the `Vector2` tagged-value coercion already in place — no
  schema churn needed.

**Acceptance:**
- [x] All 10 tools registered in `src/tool-definitions.ts` with proper
  schemas, dispatched via `src/index.ts`, and wired to the Godot bridge
  via `tool_executor.gd`.

**Why split from Phase 2:**
- Independent scope — 2D and 3D scaffolding share no code paths.
- Lets M2 ship 3D scaffolding on a tight schedule, while 2D ships in
  M2.5 / M3.

### Phase 3 — Cross-scene refactor & code analysis  **[NOT STARTED]**

Goal: enable the AI to do safe project-wide changes and reason about the
shape of the project.

**New tools:**
- Refactor:
  - [ ] `find_node_references`
  - [ ] `find_signal_connections`
  - [ ] `find_nodes_by_type`
  - [ ] `cross_scene_set_property`
  - [ ] `batch_set_property`
  - [ ] `get_scene_dependencies`
- Analysis:
  - [ ] `find_unused_resources`
  - [ ] `analyze_signal_flow`
  - [ ] `analyze_scene_complexity`
  - [ ] `find_script_references`
  - [ ] `detect_circular_dependencies`
  - [ ] `get_project_statistics`

**Where it lives:**
- `src/tools/refactor.ts` — bridge-backed for live edits, falls back to
  filesystem scan of `.tscn`/`.gd` for read-only queries (reuse
  `gdscript_parser.ts`).
- `src/tools/code_analysis.ts` — pure FS analysis; no editor required.
  Important so analysis works in CI / pre-commit contexts.
- New groups `refactor`, `code_analysis`.

### Phase 4 — Animation tree depth & ergonomics  **[NOT STARTED]**

Goal: round out animation-tree authoring and small node ergonomics.

**New tools:**
- AnimationTree:
  - [ ] `get_animation_tree_structure`
  - [ ] `add_state_machine_state`
  - [ ] `remove_state_machine_state`
  - [ ] `add_state_machine_transition`
  - [ ] `remove_state_machine_transition`
  - [ ] `set_blend_tree_node`
  - [ ] `set_tree_parameter`
- Node ergonomics:
  - [ ] `move_node` (reorder among siblings)
  - [ ] `rename_node`
  - [ ] `set_anchor_preset`
- Resource:
  - [ ] `read_resource`
  - [ ] `edit_resource`
- Editor utilities:
  - [ ] `execute_editor_script`
  - [ ] `clear_output`
  - [ ] `reload_plugin`
  - [ ] `reload_project`

**Where it lives:**
- Extend the existing `animation` group; add a new `editor_utility` group
  for the editor-side helpers.

## 4. Architecture Notes

- **Keep `compact` profile lean.** None of the new tools should be
  promoted into core; they all land in dynamic groups so the default
  33-tool surface does not grow. Update `src/tool-groups.ts` keyword
  lists so `tool.catalog` queries like `"test scenario"`, `"3d
  lighting"`, `"unused resource"` auto-activate the right group.
- **Reuse the bridge.** No new ports. Recording / replay / monitoring
  reuse runtime addon socket `7777`; new editor scaffolding reuses bridge
  port `6505`.
- **Persist test runs as MCP resources.** Each `run_test_scenario`
  invocation writes a JSON record under `.gopeak/test-runs/`; expose via
  `src/resources.ts` so clients can `resources/read` past runs without
  re-burning context.
- **Image diff stays pure JS.** Avoid pulling `sharp` or native canvas —
  ship a pHash + per-tile-mean implementation in TS so the npm install
  story stays one-step. SSIM is opt-in and lazy-required.
- **Schemas first, handlers second.** Each phase: write JSON Schemas in
  `tool-definitions.ts`, add to a new group with keywords, write a
  smoke test that activates the group via `tool.catalog`, *then*
  implement the handler. This protects against silent regressions of
  the dynamic-group plumbing.

## 5. Risks & Open Questions

- **`assert_screen_text` semantics.** Ship label-tree scan first (free,
  deterministic, covers 90% of UI tests), gate OCR behind
  `GOPEAK_ENABLE_OCR=1` with `tesseract.js`.
- **Recording determinism.** Frame-indexed replay only matches if the
  game is deterministic at the input layer. Document this; offer
  `replay_recording(speed: 'realtime' | 'frame_locked')`.
- **Stress test scope.** `run_stress_test` with random input could break
  user projects. Default to a sandboxed scene argument; require an
  explicit `confirm_destructive: true` to run against the main scene.

## 6. Milestones

| Milestone | Phases | Status | Outcome |
|---|---|---|---|
| M1 — Closed loop | 1 | DONE | AI can run a scenario and self-grade it |
| M2 — 3D-ready scaffolding | 1 + 2 | DONE | AI can build a 3D test bed and run scenarios on it |
| M2.5 — 2D scaffolding | 1 + 2b | DONE | First-class 2D scene scaffolding |
| M3 — Project intelligence | 1–3 | NOT STARTED | AI can refactor across scenes safely |
| M4 — Full closed loop + scaffolding | 1–4 | NOT STARTED | Complete AI-build / AI-run surface, plus 2D scaffolding |

Each milestone is independently shippable as a minor version bump
(`2.4.0`, `2.5.0`, …) using the existing `scripts/bump-version.mjs`
flow. CI in `.github/workflows` already runs `npm run ci` plus dynamic
group and integration tests — extend it with `test-runtime-loop.mjs`
in M1 and a `test-build-scaffolding.mjs` in M2.
