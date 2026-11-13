#!/usr/bin/env node
// Regression test for shell command injection through tool arguments (CWE-78).
// Godot must be started without a shell, so shell syntax inside projectPath,
// preset or outputPath has to reach Godot as literal text and never execute.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform === 'win32') {
  console.log('test-shell-injection: skipped on Windows (uses a POSIX fake Godot binary)');
  process.exit(0);
}

const SERVER_ENTRY = resolve(process.env.GOPEAK_TEST_SERVER_ENTRY ?? './build/index.js');
const MARKER = 'gopeak-injection-marker';
const PAYLOAD = `$(touch ${MARKER})`;

function waitForResponse(stream, id, timeoutMs = 20000) {
  let buffer = '';
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { stream.off('data', onData); reject(new Error(`Timed out waiting for response ${id}`)); }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === id) { clearTimeout(timer); stream.off('data', onData); resolvePromise(parsed); return; }
        } catch { /* non-JSON line */ }
      }
    };
    stream.on('data', onData);
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'gopeak-injection-'));
  const serverCwd = join(root, 'cwd');
  mkdirSync(serverCwd);
  const argvLog = join(root, 'argv.log');

  // Fake Godot: answers --version and records every argument it receives.
  const fakeGodot = join(root, 'godot');
  writeFileSync(fakeGodot, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "4.4.stable.official"; exit 0; fi\nfor a in "$@"; do printf '%s\\n' "$a" >> "${argvLog}"; done\nprintf -- '---\\n' >> "${argvLog}"\nexit 0\n`);
  chmodSync(fakeGodot, 0o755);

  const makeProject = (name) => {
    const dir = join(root, name);
    mkdirSync(dir);
    writeFileSync(join(dir, 'project.godot'), 'config_version=5\n\n[application]\nconfig/name="t"\n');
    writeFileSync(join(dir, 'export_presets.cfg'), '[preset.0]\n\nname="Linux"\nplatform="Linux"\nrunnable=true\nexport_path=""\n');
    return dir;
  };
  const cleanProject = makeProject('project');
  const hostileProject = makeProject(`project ${PAYLOAD}`);

  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: serverCwd,
    env: { ...process.env, GODOT_PATH: fakeGodot, GOPEAK_TOOL_PROFILE: 'full', GOPEAK_BRIDGE_PORT: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {});
  let nextId = 1;
  const call = async (method, params) => {
    const id = nextId++;
    const pending = waitForResponse(proc.stdout, id);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return await pending;
  };
  const markerExists = () => existsSync(join(serverCwd, MARKER)) || existsSync(join(cleanProject, MARKER)) || existsSync(join(hostileProject, MARKER));
  const loggedArgs = () => (existsSync(argvLog) ? readFileSync(argvLog, 'utf8').split('\n') : []);

  try {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'injection-test', version: '1.0.0' } });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

    // 1. Shell syntax in `preset` is rejected (not in export_presets.cfg) and never executes.
    const r1 = await call('tools/call', { name: 'export_project', arguments: { projectPath: cleanProject, preset: PAYLOAD, outputPath: 'build/out.zip' } });
    assert.equal(markerExists(), false, 'preset payload must not be executed by a shell');
    assert.match(JSON.stringify(r1), /Unknown export preset/, 'unknown preset must be rejected before Godot runs');
    assert.equal(loggedArgs().includes('--export-release'), false, 'Godot must not be started for an unknown preset');

    // 2. Shell syntax in `projectPath` / `outputPath` reaches Godot as literal arguments.
    await call('tools/call', { name: 'export_project', arguments: { projectPath: hostileProject, preset: 'Linux', outputPath: `out ${PAYLOAD}.zip` } });
    assert.equal(markerExists(), false, 'projectPath/outputPath payload must not be executed by a shell');
    const args2 = loggedArgs();
    assert.ok(args2.includes(hostileProject), 'projectPath must reach Godot unchanged as one argument');
    assert.ok(args2.includes(`out ${PAYLOAD}.zip`), 'outputPath must reach Godot unchanged as one argument');
    assert.ok(args2.includes('Linux'), 'preset must reach Godot as its own argument');

    // 3. Operation-based tools (executeOperation) pass projectPath literally too.
    await call('tools/call', { name: 'list_export_presets', arguments: { projectPath: hostileProject } });
    assert.equal(markerExists(), false, 'executeOperation projectPath payload must not be executed by a shell');
    const args3 = loggedArgs();
    assert.ok(args3.includes('--script'), 'operation tool must have started Godot');
    assert.ok(args3.includes('list_export_presets'), 'operation name must reach Godot');
    assert.ok(args3.some((a) => a.startsWith('@file:')), 'params file reference must reach Godot as one argument');
    assert.equal(args3.filter((a) => a === hostileProject).length >= 2, true, 'projectPath must reach Godot unchanged for operations');

    console.log('test-shell-injection: all checks passed');
  } finally {
    proc.kill('SIGTERM');
    await Promise.race([new Promise((r) => proc.once('exit', r)), delay(2000)]);
    if (proc.exitCode === null) proc.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
