import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative as relativePath, resolve as resolvePath } from 'node:path';
import { compareImages, type CompareOptions, type RegionRect } from './image_diff.js';
import {
  generateRunId,
  listTestRuns,
  readTestRun,
  writeTestRun,
  type TestAssertionRecord,
  type TestRunRecord,
  type TestStepRecord,
} from './test_reports.js';

export interface RuntimeContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface RuntimeResponse {
  content: RuntimeContent[];
  isError?: boolean;
}

export type RuntimeCommandFn = (command: string, params?: unknown) => Promise<RuntimeResponse>;

export interface ToolDeps {
  runtimeCommand: RuntimeCommandFn;
  getProjectPath: () => string | null;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 100;

function textResponse(payload: unknown): RuntimeResponse {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
  };
}

function errorResponse(message: string, possibleSolutions: string[] = []): RuntimeResponse {
  const content: RuntimeContent[] = [{ type: 'text', text: message }];
  if (possibleSolutions.length > 0) {
    content.push({ type: 'text', text: 'Possible solutions:\n- ' + possibleSolutions.join('\n- ') });
  }
  return { content, isError: true };
}

export function parseRuntimePayload(res: RuntimeResponse): any {
  const screenshot = res.content.find((c) => c.type === 'image' && c.data);
  if (screenshot) {
    return { type: 'screenshot', data: screenshot.data, mimeType: screenshot.mimeType ?? 'image/png' };
  }
  const textBlock = res.content.find((c) => c.type === 'text' && typeof c.text === 'string');
  if (!textBlock || typeof textBlock.text !== 'string') {
    return null;
  }
  const text = textBlock.text;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isOk(parsed: any): boolean {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }
  if (parsed.success === false) return false;
  if (parsed.type === 'error' || parsed.error) return false;
  return true;
}

function errorTextFromPayload(parsed: any, fallback: string): string {
  if (!parsed) return fallback;
  if (typeof parsed.error === 'string') return parsed.error;
  if (typeof parsed.message === 'string') return parsed.message;
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function clampNumber(n: unknown, lo: number, hi: number, def: number): number {
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return def;
  return Math.max(lo, Math.min(hi, num));
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

// ---------- wait_for_node ----------
export async function handleWaitForNode(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const path = asString(args?.path) ?? asString(args?.node_path);
  if (!path) return errorResponse('wait_for_node requires `path`.');
  const timeoutMs = clampNumber(args?.timeout_ms ?? args?.timeoutMs, 0, 60000, DEFAULT_TIMEOUT_MS);
  const intervalMs = clampNumber(args?.interval_ms ?? args?.intervalMs, 16, 5000, DEFAULT_POLL_INTERVAL_MS);
  const requireVisible = Boolean(args?.require_visible ?? args?.requireVisible ?? false);

  const start = Date.now();
  let lastError = 'Node not found';
  // First-shot try then poll loop.
  while (Date.now() - start <= timeoutMs) {
    const res = await deps.runtimeCommand('wait_for_node', {
      path,
      require_visible: requireVisible,
    });
    const parsed = parseRuntimePayload(res);
    if (isOk(parsed) && parsed.found === true) {
      return textResponse({ ...parsed, elapsed_ms: Date.now() - start });
    }
    lastError = errorTextFromPayload(parsed, lastError);
    if (Date.now() - start >= timeoutMs) break;
    await sleep(intervalMs);
  }
  return errorResponse(`Timed out waiting for node '${path}' after ${timeoutMs}ms (${lastError}).`);
}

// ---------- monitor_properties ----------
export async function handleMonitorProperties(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const path = asString(args?.path);
  const properties = Array.isArray(args?.properties) ? args.properties : null;
  if (!path || !properties || properties.length === 0) {
    return errorResponse('monitor_properties requires `path` and `properties` array.');
  }
  const params = {
    path,
    properties,
    duration_ms: clampNumber(args?.duration_ms ?? args?.durationMs, 16, 10000, 1000),
    sample_rate_hz: clampNumber(args?.sample_rate_hz ?? args?.sampleRateHz, 1, 120, 30),
  };
  const res = await deps.runtimeCommand('monitor_properties', params);
  const parsed = parseRuntimePayload(res);
  if (!isOk(parsed)) return errorResponse(errorTextFromPayload(parsed, 'monitor_properties failed.'));
  return textResponse(parsed);
}

// ---------- batch_get_properties ----------
export async function handleBatchGetProperties(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const queries = Array.isArray(args?.queries) ? args.queries : null;
  if (!queries || queries.length === 0) {
    return errorResponse('batch_get_properties requires a non-empty `queries` array of {path, properties}.');
  }
  const res = await deps.runtimeCommand('batch_get_properties', { queries });
  const parsed = parseRuntimePayload(res);
  if (!isOk(parsed)) return errorResponse(errorTextFromPayload(parsed, 'batch_get_properties failed.'));
  return textResponse(parsed);
}

// ---------- find_ui_elements ----------
export async function handleFindUiElements(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const params: Record<string, unknown> = {};
  if (typeof args?.text === 'string') params.text = args.text;
  if (typeof args?.type === 'string') params.type = args.type;
  if (typeof args?.name === 'string') params.name = args.name;
  if (typeof args?.root === 'string') params.root = args.root;
  if (typeof args?.case_sensitive === 'boolean') params.case_sensitive = args.case_sensitive;
  if (typeof args?.match_substring === 'boolean') params.match_substring = args.match_substring;
  if (typeof args?.max_results === 'number') params.max_results = clampNumber(args.max_results, 1, 1000, 100);

  const res = await deps.runtimeCommand('find_ui_elements', params);
  const parsed = parseRuntimePayload(res);
  if (!isOk(parsed)) return errorResponse(errorTextFromPayload(parsed, 'find_ui_elements failed.'));
  return textResponse(parsed);
}

// ---------- click_button_by_text ----------
export async function handleClickButtonByText(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const text = asString(args?.text);
  if (!text) return errorResponse('click_button_by_text requires `text`.');
  const params: Record<string, unknown> = {
    text,
    case_sensitive: args?.case_sensitive === true,
    match_substring: args?.match_substring !== false,
  };
  if (typeof args?.root === 'string') params.root = args.root;
  if (typeof args?.index === 'number') params.index = args.index;
  const res = await deps.runtimeCommand('click_button_by_text', params);
  const parsed = parseRuntimePayload(res);
  if (!isOk(parsed)) return errorResponse(errorTextFromPayload(parsed, 'click_button_by_text failed.'));
  return textResponse(parsed);
}

// ---------- assert_node_state ----------
type AssertOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'regex' | 'exists' | 'not_exists' | 'truthy' | 'falsy';

interface NodeExpectation {
  property?: string;
  op: AssertOp;
  value?: any;
  description?: string;
}

function evalExpectation(actual: any, expectation: NodeExpectation): { ok: boolean; reason?: string } {
  switch (expectation.op) {
    case 'exists':
      return { ok: actual !== undefined };
    case 'not_exists':
      return { ok: actual === undefined };
    case 'eq':
      return { ok: deepEqual(actual, expectation.value), reason: 'equality mismatch' };
    case 'neq':
      return { ok: !deepEqual(actual, expectation.value), reason: 'values are equal but expected differ' };
    case 'lt':
      return { ok: typeof actual === 'number' && actual < Number(expectation.value) };
    case 'lte':
      return { ok: typeof actual === 'number' && actual <= Number(expectation.value) };
    case 'gt':
      return { ok: typeof actual === 'number' && actual > Number(expectation.value) };
    case 'gte':
      return { ok: typeof actual === 'number' && actual >= Number(expectation.value) };
    case 'in':
      return { ok: Array.isArray(expectation.value) && expectation.value.includes(actual) };
    case 'regex':
      try {
        return { ok: typeof actual === 'string' && new RegExp(String(expectation.value)).test(actual) };
      } catch (err) {
        return { ok: false, reason: `invalid regex: ${(err as Error).message}` };
      }
    case 'truthy':
      return { ok: Boolean(actual) };
    case 'falsy':
      return { ok: !actual };
    default:
      return { ok: false, reason: `unknown op '${expectation.op}'` };
  }
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

export async function handleAssertNodeState(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const path = asString(args?.path);
  const expectationsRaw = args?.expectations;
  if (!path || !Array.isArray(expectationsRaw) || expectationsRaw.length === 0) {
    return errorResponse('assert_node_state requires `path` and a non-empty `expectations` array.');
  }
  const expectations: NodeExpectation[] = expectationsRaw.map((e) => ({
    property: typeof e?.property === 'string' ? e.property : undefined,
    op: (e?.op ?? 'eq') as AssertOp,
    value: e?.value,
    description: typeof e?.description === 'string' ? e.description : undefined,
  }));

  const opsRequiringProperty: AssertOp[] = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'regex', 'truthy', 'falsy'];
  const missingProperty = expectations.findIndex(
    (e) => opsRequiringProperty.includes(e.op) && !e.property,
  );
  if (missingProperty !== -1) {
    const bad = expectations[missingProperty];
    return errorResponse(
      `assert_node_state expectation #${missingProperty} with op '${bad.op}' requires a 'property' field.`,
    );
  }

  const propsToQuery = expectations.filter((e) => e.property && e.op !== 'exists' && e.op !== 'not_exists').map((e) => e.property!);
  const uniqueProps = Array.from(new Set(propsToQuery));

  const res = await deps.runtimeCommand('batch_get_properties', {
    queries: [{ path, properties: uniqueProps }],
  });
  const parsed = parseRuntimePayload(res);
  if (!isOk(parsed)) {
    const exists = expectations.find((e) => e.op === 'not_exists');
    if (exists) {
      // not_exists is satisfied when node was missing
      return textResponse({ passed: true, results: [{ property: null, op: 'not_exists', ok: true }] });
    }
    return errorResponse(errorTextFromPayload(parsed, 'assert_node_state: failed to read node state.'));
  }

  const result0 = (parsed.results && parsed.results[0]) || {};
  const props: Record<string, any> = result0.properties || {};
  const nodeFound = result0.found !== false;

  const results = expectations.map((exp, i) => {
    let actual: any;
    if (exp.op === 'exists') {
      const ok = nodeFound;
      return { index: i, property: exp.property ?? null, op: exp.op, expected: exp.value, actual: nodeFound, ok };
    }
    if (exp.op === 'not_exists') {
      return { index: i, property: exp.property ?? null, op: exp.op, expected: exp.value, actual: nodeFound, ok: !nodeFound };
    }
    if (!nodeFound) {
      return { index: i, property: exp.property ?? null, op: exp.op, expected: exp.value, actual: undefined, ok: false, error: 'node not found' };
    }
    actual = exp.property ? props[exp.property] : undefined;
    const evalRes = evalExpectation(actual, exp);
    return { index: i, property: exp.property ?? null, op: exp.op, expected: exp.value, actual, ok: evalRes.ok, error: evalRes.ok ? undefined : evalRes.reason };
  });

  const passed = results.every((r) => r.ok);
  return textResponse({ passed, path, results });
}

// ---------- assert_screen_text ----------
export async function handleAssertScreenText(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const text = asString(args?.text);
  if (!text) return errorResponse('assert_screen_text requires `text`.');
  const caseSensitive = args?.case_sensitive === true;

  if (args?.ocr === true) {
    return errorResponse('OCR mode is not bundled in this build. Disable `ocr` to fall back to scene-graph label scanning.');
  }

  const params: Record<string, unknown> = {};
  if (typeof args?.root === 'string') params.root = args.root;
  const res = await deps.runtimeCommand('get_label_texts', params);
  const parsed = parseRuntimePayload(res);
  if (!isOk(parsed)) return errorResponse(errorTextFromPayload(parsed, 'assert_screen_text: failed to read labels.'));
  const labels: Array<{ path: string; text: string; type?: string }> = Array.isArray(parsed.labels) ? parsed.labels : [];
  const needle = caseSensitive ? text : text.toLowerCase();
  const matches = labels
    .filter((l) => {
      const hay = caseSensitive ? l.text : (l.text || '').toLowerCase();
      return hay.includes(needle);
    })
    .map((l) => ({ path: l.path, text: l.text, type: l.type }));

  return textResponse({
    passed: matches.length > 0,
    needle: text,
    case_sensitive: caseSensitive,
    match_count: matches.length,
    matches,
    searched: labels.length,
  });
}

// ---------- compare_screenshots ----------
function resolveProjectFile(projectPath: string | null, inputPath: string): string {
  if (!projectPath) {
    throw new Error('Image path requires a project path. Set a Godot project path or pass base64 data.');
  }
  if (isAbsolute(inputPath)) {
    throw new Error('Image path must be relative to the project directory.');
  }
  if (inputPath.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error('Image path may not contain ".." segments.');
  }
  const abs = resolvePath(projectPath, inputPath);
  const rel = relativePath(projectPath, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Image path escapes the project directory.');
  }
  return abs;
}

async function loadPngFromArg(value: any, projectPath: string | null): Promise<{ buffer: Buffer; source: string }> {
  if (typeof value === 'string') {
    // base64 png data URI or raw base64 string
    let b64 = value;
    const dataUriMatch = b64.match(/^data:image\/png;base64,(.*)$/);
    if (dataUriMatch) b64 = dataUriMatch[1];
    if (/^[A-Za-z0-9+/=\s]+$/.test(b64)) {
      const buf = Buffer.from(b64, 'base64');
      if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return { buffer: buf, source: 'base64' };
      }
    }
    const abs = resolveProjectFile(projectPath, value);
    if (!existsSync(abs)) throw new Error(`Image file not found: ${value}`);
    return { buffer: readFileSync(abs), source: abs };
  }
  if (value && typeof value === 'object') {
    if (typeof value.path === 'string') {
      const abs = resolveProjectFile(projectPath, value.path);
      if (!existsSync(abs)) throw new Error(`Image file not found: ${value.path}`);
      return { buffer: readFileSync(abs), source: abs };
    }
    if (typeof value.base64 === 'string') {
      return { buffer: Buffer.from(value.base64, 'base64'), source: 'base64' };
    }
  }
  throw new Error('Image source must be a base64 string, file path string, or {path|base64} object.');
}

export async function handleCompareScreenshots(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  if (!args?.a || !args?.b) return errorResponse('compare_screenshots requires `a` and `b` (base64 PNGs or paths).');
  try {
    const projectPath = deps.getProjectPath();
    const [aImg, bImg] = await Promise.all([loadPngFromArg(args.a, projectPath), loadPngFromArg(args.b, projectPath)]);
    const opts: CompareOptions = {};
    if (typeof args.tolerance === 'number') opts.tolerance = args.tolerance;
    if (typeof args.hash_size === 'number') opts.hashSize = args.hash_size;
    if (typeof args.tile_grid === 'number') opts.tileGrid = args.tile_grid;
    if (args.region && typeof args.region === 'object') {
      const r: RegionRect = {
        x: Number(args.region.x ?? 0),
        y: Number(args.region.y ?? 0),
        width: Number(args.region.width ?? args.region.w ?? 0),
        height: Number(args.region.height ?? args.region.h ?? 0),
      };
      opts.region = r;
    }
    const result = compareImages(aImg.buffer, bImg.buffer, opts);
    return textResponse({ ...result, sources: { a: aImg.source, b: bImg.source } });
  } catch (err) {
    return errorResponse(`compare_screenshots failed: ${(err as Error).message}`);
  }
}

// ---------- capture_frames ----------
export async function handleCaptureFrames(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const params = {
    count: clampNumber(args?.count, 1, 30, 5),
    interval_ms: clampNumber(args?.interval_ms ?? args?.intervalMs, 0, 1000, 100),
    width: typeof args?.width === 'number' ? args.width : undefined,
    height: typeof args?.height === 'number' ? args.height : undefined,
  };
  const res = await deps.runtimeCommand('capture_frames', params);
  const parsed = parseRuntimePayload(res);
  if (!isOk(parsed)) return errorResponse(errorTextFromPayload(parsed, 'capture_frames failed.'));
  return textResponse(parsed);
}

// ---------- get_editor_screenshot ----------
export async function handleGetEditorScreenshot(_args: any, _deps: ToolDeps): Promise<RuntimeResponse> {
  return errorResponse(
    'get_editor_screenshot is not available in this build. The MCP runtime addon captures the running game viewport (use capture_screenshot). Editor-side capture requires the editor plugin bridge.',
    [
      'Use capture_screenshot to capture the running game viewport.',
      'For editor-side capture, ensure the Godot editor plugin bridge is connected.',
    ],
  );
}

// ---------- start/stop/replay recording ----------
export async function handleStartRecording(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const params: Record<string, unknown> = {};
  if (typeof args?.name === 'string') params.name = args.name;
  if (typeof args?.mode === 'string') params.mode = args.mode;
  const res = await deps.runtimeCommand('start_recording', params);
  const parsed = parseRuntimePayload(res);
  if (!isOk(parsed)) return errorResponse(errorTextFromPayload(parsed, 'start_recording failed.'));
  return textResponse(parsed);
}

export async function handleStopRecording(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const params: Record<string, unknown> = {};
  if (typeof args?.name === 'string') params.name = args.name;
  const res = await deps.runtimeCommand('stop_recording', params);
  const parsed = parseRuntimePayload(res);
  if (!isOk(parsed)) return errorResponse(errorTextFromPayload(parsed, 'stop_recording failed.'));
  return textResponse(parsed);
}

export async function handleReplayRecording(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const name = asString(args?.name);
  if (!name) return errorResponse('replay_recording requires `name`.');
  const params: Record<string, unknown> = { name };
  if (typeof args?.mode === 'string') params.mode = args.mode;
  if (typeof args?.speed === 'number') params.speed = clampNumber(args.speed, 0.1, 10, 1);
  const res = await deps.runtimeCommand('replay_recording', params);
  const parsed = parseRuntimePayload(res);
  if (!isOk(parsed)) return errorResponse(errorTextFromPayload(parsed, 'replay_recording failed.'));
  return textResponse(parsed);
}

// ---------- get_performance_monitors ----------
export async function handleGetPerformanceMonitors(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const params: Record<string, unknown> = {};
  if (Array.isArray(args?.monitors)) params.monitors = args.monitors;
  const res = await deps.runtimeCommand('get_performance_monitors', params);
  const parsed = parseRuntimePayload(res);
  if (!isOk(parsed)) return errorResponse(errorTextFromPayload(parsed, 'get_performance_monitors failed.'));
  return textResponse(parsed);
}

// ---------- get_test_report ----------
export async function handleGetTestReport(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const projectPath = deps.getProjectPath();
  if (!projectPath) return errorResponse('Project path is not set. Set a Godot project path first.');
  try {
    const id = asString(args?.run_id ?? args?.id);
    if (id) {
      const record = readTestRun(projectPath, id);
      return textResponse(record);
    }
    const limit = clampNumber(args?.limit, 1, 200, 20);
    const list = listTestRuns(projectPath).slice(0, limit);
    if (args?.latest === true && list[0]) {
      const record = readTestRun(projectPath, list[0].id);
      return textResponse(record);
    }
    return textResponse({ runs: list });
  } catch (err) {
    return errorResponse(`get_test_report failed: ${(err as Error).message}`);
  }
}

// ---------- run_test_scenario ----------
interface ScenarioStep {
  type: string;
  args?: any;
  optional?: boolean;
  description?: string;
}

interface ScenarioAssertion {
  type: 'assert_node_state' | 'assert_screen_text' | 'assert_property' | 'assert_image_match';
  description?: string;
  [key: string]: any;
}

interface ScenarioInput {
  name?: string;
  setup?: ScenarioStep[];
  steps?: ScenarioStep[];
  asserts?: ScenarioAssertion[];
  teardown?: ScenarioStep[];
  metadata?: Record<string, unknown>;
  notes?: string;
}

const STEP_TO_RUNTIME_COMMAND: Record<string, string> = {
  capture_screenshot: 'capture_screenshot',
  capture_viewport: 'capture_viewport',
  inject_action: 'inject_action',
  inject_key: 'inject_key',
  inject_mouse_click: 'inject_mouse_click',
  inject_mouse_motion: 'inject_mouse_motion',
  set_property: 'set_property',
  call_method: 'call_method',
  get_property: 'get_property',
  get_tree: 'get_tree',
  get_metrics: 'get_metrics',
  get_engine_state: 'get_engine_state',
  get_performance_monitors: 'get_performance_monitors',
  get_label_texts: 'get_label_texts',
};

async function runScenarioStep(step: ScenarioStep, deps: ToolDeps): Promise<TestStepRecord> {
  const startedAt = Date.now();
  const baseRecord = (ok: boolean, extra: Partial<TestStepRecord>): TestStepRecord => ({
    index: 0,
    type: step.type,
    args: step.args,
    ok,
    durationMs: Date.now() - startedAt,
    ...extra,
  });

  try {
    switch (step.type) {
      case 'wait_ms': {
        const ms = clampNumber(step.args?.ms ?? step.args, 0, 60000, 0);
        await sleep(ms);
        return baseRecord(true, { result: { waited_ms: ms } });
      }
      case 'wait_for_node': {
        const r = await handleWaitForNode(step.args ?? {}, deps);
        const parsed = parseRuntimePayload(r);
        return baseRecord(!r.isError, { result: parsed, error: r.isError ? errorTextFromPayload(parsed, 'wait_for_node failed') : undefined });
      }
      case 'click_button_by_text': {
        const r = await handleClickButtonByText(step.args ?? {}, deps);
        const parsed = parseRuntimePayload(r);
        return baseRecord(!r.isError, { result: parsed, error: r.isError ? errorTextFromPayload(parsed, 'click_button_by_text failed') : undefined });
      }
      case 'find_ui_elements': {
        const r = await handleFindUiElements(step.args ?? {}, deps);
        const parsed = parseRuntimePayload(r);
        return baseRecord(!r.isError, { result: parsed, error: r.isError ? errorTextFromPayload(parsed, 'find_ui_elements failed') : undefined });
      }
      case 'replay_recording': {
        const r = await handleReplayRecording(step.args ?? {}, deps);
        const parsed = parseRuntimePayload(r);
        return baseRecord(!r.isError, { result: parsed, error: r.isError ? errorTextFromPayload(parsed, 'replay_recording failed') : undefined });
      }
      case 'monitor_properties': {
        const r = await handleMonitorProperties(step.args ?? {}, deps);
        const parsed = parseRuntimePayload(r);
        return baseRecord(!r.isError, { result: parsed, error: r.isError ? errorTextFromPayload(parsed, 'monitor_properties failed') : undefined });
      }
      case 'capture_frames': {
        const r = await handleCaptureFrames(step.args ?? {}, deps);
        const parsed = parseRuntimePayload(r);
        return baseRecord(!r.isError, { result: parsed, error: r.isError ? errorTextFromPayload(parsed, 'capture_frames failed') : undefined });
      }
      default: {
        const cmd = STEP_TO_RUNTIME_COMMAND[step.type];
        if (!cmd) {
          return baseRecord(false, { error: `Unknown step type '${step.type}'.` });
        }
        const r = await deps.runtimeCommand(cmd, step.args ?? {});
        const parsed = parseRuntimePayload(r);
        const ok = !r.isError && isOk(parsed);
        return baseRecord(ok, { result: parsed, error: ok ? undefined : errorTextFromPayload(parsed, `${cmd} failed`) });
      }
    }
  } catch (err) {
    return baseRecord(false, { error: (err as Error).message });
  }
}

async function runScenarioAssertion(assertion: ScenarioAssertion, deps: ToolDeps): Promise<TestAssertionRecord> {
  const baseRecord = (ok: boolean, extra: Partial<TestAssertionRecord>): TestAssertionRecord => ({
    index: 0,
    type: assertion.type,
    description: assertion.description,
    ok,
    ...extra,
  });

  try {
    switch (assertion.type) {
      case 'assert_node_state': {
        const r = await handleAssertNodeState(assertion, deps);
        const parsed = parseRuntimePayload(r);
        const ok = !r.isError && parsed?.passed === true;
        return baseRecord(ok, { actual: parsed, error: ok ? undefined : errorTextFromPayload(parsed, 'assertion failed') });
      }
      case 'assert_screen_text': {
        const r = await handleAssertScreenText(assertion, deps);
        const parsed = parseRuntimePayload(r);
        const ok = !r.isError && parsed?.passed === true;
        return baseRecord(ok, { actual: parsed, error: ok ? undefined : errorTextFromPayload(parsed, 'screen text not found') });
      }
      case 'assert_image_match': {
        const r = await handleCompareScreenshots(assertion, deps);
        const parsed = parseRuntimePayload(r);
        const ok = !r.isError && parsed?.pass === true;
        return baseRecord(ok, { actual: parsed, error: ok ? undefined : errorTextFromPayload(parsed, 'image mismatch') });
      }
      case 'assert_property': {
        const r = await handleAssertNodeState(
          { path: assertion.path, expectations: [{ property: assertion.property, op: assertion.op ?? 'eq', value: assertion.value }] },
          deps,
        );
        const parsed = parseRuntimePayload(r);
        const ok = !r.isError && parsed?.passed === true;
        return baseRecord(ok, { actual: parsed, expected: assertion.value, error: ok ? undefined : errorTextFromPayload(parsed, 'property assertion failed') });
      }
      default:
        return baseRecord(false, { error: `Unknown assertion type '${assertion.type}'.` });
    }
  } catch (err) {
    return baseRecord(false, { error: (err as Error).message });
  }
}

export async function handleRunTestScenario(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  const projectPath = deps.getProjectPath();
  if (!projectPath) return errorResponse('Project path is not set. Set a Godot project path first.');

  const scenario: ScenarioInput = {
    name: asString(args?.name),
    setup: Array.isArray(args?.setup) ? args.setup : [],
    steps: Array.isArray(args?.steps) ? args.steps : [],
    asserts: Array.isArray(args?.asserts) ? args.asserts : [],
    teardown: Array.isArray(args?.teardown) ? args.teardown : [],
    metadata: args?.metadata,
    notes: asString(args?.notes),
  };

  if ((scenario.steps?.length ?? 0) === 0 && (scenario.asserts?.length ?? 0) === 0) {
    return errorResponse('run_test_scenario requires at least one step or assertion.');
  }

  const id = generateRunId();
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const setupRecords: TestStepRecord[] = [];
  const stepRecords: TestStepRecord[] = [];
  const assertRecords: TestAssertionRecord[] = [];
  const teardownRecords: TestStepRecord[] = [];

  let aborted = false;

  for (let i = 0; i < (scenario.setup?.length ?? 0); i++) {
    const step = scenario.setup![i];
    const rec = await runScenarioStep(step, deps);
    rec.index = i;
    setupRecords.push(rec);
    if (!rec.ok && !step.optional) {
      aborted = true;
      break;
    }
  }

  if (!aborted) {
    for (let i = 0; i < (scenario.steps?.length ?? 0); i++) {
      const step = scenario.steps![i];
      const rec = await runScenarioStep(step, deps);
      rec.index = i;
      stepRecords.push(rec);
      if (!rec.ok && !step.optional) {
        aborted = true;
        break;
      }
    }
  }

  if (!aborted) {
    for (let i = 0; i < (scenario.asserts?.length ?? 0); i++) {
      const a = scenario.asserts![i];
      const rec = await runScenarioAssertion(a, deps);
      rec.index = i;
      assertRecords.push(rec);
    }
  }

  // teardown always runs
  for (let i = 0; i < (scenario.teardown?.length ?? 0); i++) {
    const step = scenario.teardown![i];
    const rec = await runScenarioStep(step, deps);
    rec.index = i;
    teardownRecords.push(rec);
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - start;
  const setupOk = setupRecords.every((s) => s.ok || scenario.setup?.[s.index]?.optional);
  const stepsOk = stepRecords.every((s) => s.ok || scenario.steps?.[s.index]?.optional);
  const assertsOk = assertRecords.every((a) => a.ok);
  const passed = setupOk && stepsOk && assertsOk && !aborted;

  const record: TestRunRecord = {
    id,
    scenarioName: scenario.name,
    startedAt,
    finishedAt,
    durationMs,
    passed,
    steps: stepRecords,
    asserts: assertRecords,
    setup: setupRecords.length > 0 ? setupRecords : undefined,
    teardown: teardownRecords.length > 0 ? teardownRecords : undefined,
    notes: scenario.notes,
    metadata: scenario.metadata,
  };

  let path: string | null = null;
  try {
    path = writeTestRun(projectPath, record);
  } catch (err) {
    return errorResponse(`Test scenario completed but persistence failed: ${(err as Error).message}`);
  }

  return textResponse({
    id,
    passed,
    durationMs,
    uri: `godot://test-run/${id}`,
    path,
    summary: {
      setup_count: setupRecords.length,
      step_count: stepRecords.length,
      assert_count: assertRecords.length,
      teardown_count: teardownRecords.length,
      failed_steps: stepRecords.filter((s) => !s.ok).length,
      failed_asserts: assertRecords.filter((a) => !a.ok).length,
    },
  });
}

// ---------- run_stress_test ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_STRESS_ACTIONS = ['inject_key', 'inject_mouse_motion', 'inject_mouse_click', 'inject_action'];
const DEFAULT_KEYS = ['W', 'A', 'S', 'D', 'Space', 'Enter', 'Escape', 'Up', 'Down', 'Left', 'Right'];
const DEFAULT_ACTIONS = ['ui_accept', 'ui_cancel', 'ui_left', 'ui_right', 'ui_up', 'ui_down'];

export async function handleRunStressTest(args: any, deps: ToolDeps): Promise<RuntimeResponse> {
  if (args?.confirm_destructive !== true) {
    return errorResponse(
      'run_stress_test refused: this fuzzer injects random inputs which may trigger destructive in-game behavior. Pass `confirm_destructive: true` to proceed.',
    );
  }
  const projectPath = deps.getProjectPath();
  const seed = clampNumber(args?.seed, 0, 0xffffffff, Math.floor(Math.random() * 0xffffffff));
  const durationMs = clampNumber(args?.duration_ms ?? args?.durationMs, 100, 120000, 5000);
  const intervalMs = clampNumber(args?.interval_ms ?? args?.intervalMs, 16, 1000, 50);
  const actionSet = Array.isArray(args?.action_set) && args.action_set.length > 0 ? args.action_set : DEFAULT_STRESS_ACTIONS;
  const viewportWidth = clampNumber(args?.viewport_width, 16, 8192, 1280);
  const viewportHeight = clampNumber(args?.viewport_height, 16, 8192, 720);

  const rng = mulberry32(seed);
  const id = generateRunId();
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const stepRecords: TestStepRecord[] = [];
  let i = 0;

  while (Date.now() - start < durationMs) {
    const choice = actionSet[Math.floor(rng() * actionSet.length)];
    const stepStart = Date.now();
    let cmd = '';
    let params: Record<string, unknown> = {};
    switch (choice) {
      case 'inject_key':
        cmd = 'inject_key';
        params = { keycode: DEFAULT_KEYS[Math.floor(rng() * DEFAULT_KEYS.length)], pressed: rng() > 0.5 };
        break;
      case 'inject_mouse_motion':
        cmd = 'inject_mouse_motion';
        params = { x: Math.floor(rng() * viewportWidth), y: Math.floor(rng() * viewportHeight) };
        break;
      case 'inject_mouse_click':
        cmd = 'inject_mouse_click';
        params = {
          x: Math.floor(rng() * viewportWidth),
          y: Math.floor(rng() * viewportHeight),
          button: rng() > 0.8 ? 'right' : 'left',
          pressed: rng() > 0.5,
        };
        break;
      case 'inject_action':
        cmd = 'inject_action';
        params = { action: DEFAULT_ACTIONS[Math.floor(rng() * DEFAULT_ACTIONS.length)], pressed: rng() > 0.5 };
        break;
      default:
        cmd = String(choice);
        params = {};
    }
    try {
      const r = await deps.runtimeCommand(cmd, params);
      const parsed = parseRuntimePayload(r);
      stepRecords.push({
        index: i,
        type: cmd,
        args: params,
        ok: !r.isError && isOk(parsed),
        durationMs: Date.now() - stepStart,
        result: parsed,
        error: r.isError ? errorTextFromPayload(parsed, `${cmd} failed`) : undefined,
      });
    } catch (err) {
      stepRecords.push({
        index: i,
        type: cmd,
        args: params,
        ok: false,
        durationMs: Date.now() - stepStart,
        error: (err as Error).message,
      });
    }
    i++;
    await sleep(intervalMs);
  }

  const finishedAt = new Date().toISOString();
  const durationActual = Date.now() - start;
  const failedSteps = stepRecords.filter((s) => !s.ok).length;
  const passed = failedSteps === 0;

  const record: TestRunRecord = {
    id,
    scenarioName: asString(args?.name) ?? 'stress_test',
    startedAt,
    finishedAt,
    durationMs: durationActual,
    passed,
    steps: stepRecords,
    asserts: [],
    notes: `Stress test seed=${seed} action_set=${actionSet.join(',')}`,
    metadata: {
      seed,
      action_set: actionSet,
      requested_duration_ms: durationMs,
      interval_ms: intervalMs,
      viewport: { width: viewportWidth, height: viewportHeight },
    },
  };

  let path: string | null = null;
  try {
    if (projectPath) path = writeTestRun(projectPath, record);
  } catch {
    // best-effort persistence
  }

  return textResponse({
    id,
    passed,
    seed,
    duration_ms: durationActual,
    iterations: stepRecords.length,
    failed_steps: failedSteps,
    uri: path ? `godot://test-run/${id}` : null,
    path,
  });
}
