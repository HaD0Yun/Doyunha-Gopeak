#!/usr/bin/env node
/**
 * Smoke test for Phase 1 closed-loop runtime testing.
 *
 * Exercises the runtime_test handlers without requiring a running Godot game by
 * stubbing the runtime command function. Verifies:
 *   1. run_test_scenario executes setup/steps/asserts/teardown
 *   2. Test report is persisted to <project>/.gopeak/test-runs/<id>.json
 *   3. get_test_report retrieves the persisted record
 *   4. compare_screenshots returns pass=true for identical PNGs
 *   5. wait_for_node times out gracefully when the node is missing
 *   6. run_stress_test refuses without confirm_destructive
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleAssertNodeState,
  handleCompareScreenshots,
  handleGetTestReport,
  handleRunStressTest,
  handleRunTestScenario,
  handleWaitForNode,
} from './build/tools/runtime_test.js';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed++;
  console.log(`  PASS  ${name}`);
}
function fail(name, err) {
  failed++;
  failures.push({ name, err });
  console.log(`  FAIL  ${name}: ${err?.message ?? err}`);
}

// 1x1 black PNG (known-good)
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';

function textPayload(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

function makeMockRuntime(scenarioState) {
  return async function mockRuntime(command, params) {
    scenarioState.calls.push({ command, params });
    switch (command) {
      case 'wait_for_node': {
        const exists = scenarioState.existingNodes.has(params?.path);
        return textPayload({ success: exists, found: exists, path: params?.path });
      }
      case 'batch_get_properties': {
        const queries = params?.queries ?? [];
        const results = queries.map((q) => {
          const props = {};
          if (Array.isArray(q.properties)) {
            for (const p of q.properties) {
              props[p] = scenarioState.properties[`${q.path}.${p}`];
            }
          }
          return { path: q.path, found: scenarioState.existingNodes.has(q.path), properties: props };
        });
        return textPayload({ success: true, results });
      }
      case 'click_button_by_text':
        return textPayload({ success: true, clicked: 1, text: params?.text });
      case 'capture_screenshot':
        return {
          content: [
            { type: 'text', text: JSON.stringify({ success: true, width: 1, height: 1 }) },
            { type: 'image', data: TINY_PNG_B64, mimeType: 'image/png' },
          ],
        };
      case 'inject_key':
      case 'inject_action':
      case 'inject_mouse_click':
      case 'inject_mouse_motion':
        return textPayload({ success: true });
      case 'get_label_texts':
        return textPayload({
          success: true,
          labels: [
            { path: '/root/Main/Label', text: 'Hello world', type: 'Label' },
            { path: '/root/Main/Score', text: 'Score: 42', type: 'Label' },
          ],
        });
      case 'get_performance_monitors':
        return textPayload({ success: true, monitors: { 'time/fps': 60 } });
      default:
        return textPayload({ success: true, command });
    }
  };
}

async function runTests() {
  const projectDir = mkdtempSync(join(tmpdir(), 'gopeak-runtime-loop-'));

  try {
    // ---- Test 1: closed-loop scenario passes and persists ----
    const state1 = {
      calls: [],
      existingNodes: new Set(['/root/Main', '/root/Main/Player']),
      properties: {
        '/root/Main/Player.health': 100,
        '/root/Main/Player.visible': true,
      },
    };
    const deps1 = { runtimeCommand: makeMockRuntime(state1), getProjectPath: () => projectDir };

    const scenario = {
      name: 'smoke-passing-scenario',
      setup: [{ type: 'wait_for_node', args: { path: '/root/Main', timeout_ms: 200, interval_ms: 25 } }],
      steps: [
        { type: 'inject_action', args: { action: 'ui_accept', pressed: true } },
        { type: 'wait_ms', args: { ms: 5 } },
      ],
      asserts: [
        {
          type: 'assert_node_state',
          path: '/root/Main/Player',
          expectations: [
            { property: 'health', op: 'eq', value: 100 },
            { property: 'visible', op: 'truthy' },
          ],
        },
        { type: 'assert_screen_text', text: 'Hello world' },
      ],
      teardown: [{ type: 'inject_key', args: { keycode: 'Escape', pressed: true } }],
    };

    const res1 = await handleRunTestScenario(scenario, deps1);
    const parsed1 = JSON.parse(res1.content[0].text);
    try {
      assert.equal(res1.isError, undefined, 'response should not be an error');
      assert.equal(parsed1.passed, true, 'scenario should pass');
      assert.equal(parsed1.summary.assert_count, 2);
      assert.equal(parsed1.summary.failed_steps, 0);
      assert.equal(parsed1.summary.failed_asserts, 0);
      assert.match(parsed1.uri, /^godot:\/\/test-run\//);
      assert.ok(existsSync(parsed1.path), `persisted file should exist at ${parsed1.path}`);
      const persisted = JSON.parse(readFileSync(parsed1.path, 'utf-8'));
      assert.equal(persisted.id, parsed1.id);
      assert.equal(persisted.passed, true);
      assert.equal(persisted.scenarioName, 'smoke-passing-scenario');
      assert.ok(Array.isArray(persisted.teardown) && persisted.teardown.length === 1);
      ok('run_test_scenario passes and persists report');
    } catch (err) {
      fail('run_test_scenario passes and persists report', err);
    }

    // ---- Test 2: get_test_report retrieves the persisted record ----
    try {
      const reportRes = await handleGetTestReport({ latest: true }, deps1);
      const reportParsed = JSON.parse(reportRes.content[0].text);
      assert.equal(reportParsed.id, parsed1.id);
      assert.equal(reportParsed.passed, true);
      ok('get_test_report retrieves latest run');
    } catch (err) {
      fail('get_test_report retrieves latest run', err);
    }

    // Verify directory layout
    try {
      const runsDir = join(projectDir, '.gopeak', 'test-runs');
      const files = readdirSync(runsDir);
      assert.ok(files.length >= 1, 'at least one report on disk');
      ok('.gopeak/test-runs directory contains report');
    } catch (err) {
      fail('.gopeak/test-runs directory contains report', err);
    }

    // ---- Test 3: compare_screenshots returns pass for identical PNGs ----
    try {
      const cmpRes = await handleCompareScreenshots(
        { a: TINY_PNG_B64, b: TINY_PNG_B64, tolerance: 0.01 },
        deps1,
      );
      const parsed = JSON.parse(cmpRes.content[0].text);
      assert.equal(parsed.pass, true, 'identical PNGs should pass diff');
      assert.equal(parsed.tileMeanDiff, 0);
      ok('compare_screenshots: identical PNGs pass');
    } catch (err) {
      fail('compare_screenshots: identical PNGs pass', err);
    }

    // ---- Test 4: wait_for_node times out gracefully when node missing ----
    try {
      const t0 = Date.now();
      const waitRes = await handleWaitForNode(
        { path: '/root/DoesNotExist', timeout_ms: 80, interval_ms: 25 },
        deps1,
      );
      const elapsed = Date.now() - t0;
      assert.equal(waitRes.isError, true, 'should be an error');
      assert.ok(elapsed >= 70, `should wait at least the timeout (${elapsed}ms)`);
      assert.ok(elapsed < 1500, `should not hang (${elapsed}ms)`);
      ok('wait_for_node: times out cleanly');
    } catch (err) {
      fail('wait_for_node: times out cleanly', err);
    }

    // ---- Test 5: assert_node_state catches mismatched property ----
    try {
      const aRes = await handleAssertNodeState(
        {
          path: '/root/Main/Player',
          expectations: [{ property: 'health', op: 'eq', value: 0 }],
        },
        deps1,
      );
      const parsed = JSON.parse(aRes.content[0].text);
      assert.equal(parsed.passed, false, 'should report mismatch');
      assert.equal(parsed.results[0].actual, 100);
      ok('assert_node_state: detects mismatch');
    } catch (err) {
      fail('assert_node_state: detects mismatch', err);
    }

    // ---- Test 6: run_stress_test refuses without confirm_destructive ----
    try {
      const stressRes = await handleRunStressTest({}, deps1);
      assert.equal(stressRes.isError, true);
      assert.match(stressRes.content[0].text, /confirm_destructive/);
      ok('run_stress_test: refuses without confirm_destructive');
    } catch (err) {
      fail('run_stress_test: refuses without confirm_destructive', err);
    }

    // ---- Test 7: scenario aborts when non-optional step fails ----
    const state2 = {
      calls: [],
      existingNodes: new Set(['/root/Main']), // missing Boss
      properties: {},
    };
    const deps2 = { runtimeCommand: makeMockRuntime(state2), getProjectPath: () => projectDir };
    try {
      const failingScenario = {
        name: 'smoke-failing-scenario',
        steps: [
          { type: 'wait_for_node', args: { path: '/root/Main/Boss', timeout_ms: 60, interval_ms: 20 } },
          { type: 'inject_action', args: { action: 'ui_cancel' } }, // should not run
        ],
      };
      const res = await handleRunTestScenario(failingScenario, deps2);
      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.passed, false);
      assert.equal(parsed.summary.step_count, 1, 'second step should not have run');
      assert.equal(parsed.summary.failed_steps, 1);
      ok('run_test_scenario: aborts on non-optional step failure');
    } catch (err) {
      fail('run_test_scenario: aborts on non-optional step failure', err);
    }

    // ---- Test 8: optional step failure does not abort ----
    try {
      const optionalScenario = {
        name: 'smoke-optional',
        steps: [
          {
            type: 'wait_for_node',
            args: { path: '/root/Main/Optional', timeout_ms: 30, interval_ms: 20 },
            optional: true,
          },
          { type: 'inject_action', args: { action: 'ui_accept' } },
        ],
      };
      const res = await handleRunTestScenario(optionalScenario, deps2);
      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.summary.step_count, 2, 'second step should still run');
      ok('run_test_scenario: optional step failure does not abort');
    } catch (err) {
      fail('run_test_scenario: optional step failure does not abort', err);
    }
  } finally {
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
}

await runTests();

console.log(`\nPhase 1 runtime loop smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failures:');
  for (const f of failures) console.error(` - ${f.name}: ${f.err?.stack ?? f.err}`);
  process.exit(1);
}
