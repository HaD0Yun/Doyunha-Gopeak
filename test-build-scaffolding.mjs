#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import { sanitizeToolName } from './test-support/tool-name.mjs';

const SERVER_ENTRY = './build/index.js';

let passCount = 0;
let failCount = 0;
let nextId = 1;

function pass(message) {
  passCount += 1;
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failCount += 1;
  console.log(`FAIL: ${message}`);
}

function assert(condition, successMessage, failureMessage) {
  if (condition) {
    pass(successMessage);
    return true;
  }
  fail(failureMessage || successMessage);
  return false;
}

function makeRequest(method, params = {}) {
  return { jsonrpc: '2.0', id: nextId++, method, params };
}

class StdioJsonRpcClient {
  constructor(child) {
    this.child = child;
    this.buffer = '';
    this.pending = new Map();
    this.notifications = [];
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      this.#drainBuffer();
    });
  }

  #drainBuffer() {
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) return;
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (typeof message.id !== 'undefined' && this.pending.has(message.id)) {
        const resolver = this.pending.get(message.id);
        this.pending.delete(message.id);
        resolver(message);
      } else {
        this.notifications.push(message);
      }
    }
  }

  send(method, params = {}, timeoutMs = 15000) {
    const request = makeRequest(method, params);
    const payload = `${JSON.stringify(request)}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`Timed out waiting for response to ${method}`));
      }, timeoutMs);
      this.pending.set(request.id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.child.stdin.write(payload, (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(request.id); reject(error); }
      });
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }
}

function parseToolCallJson(response) {
  if (response?.error) throw new Error(response.error.message || 'Tool call returned JSON-RPC error');
  const text = (response?.result?.content || [])
    .filter((c) => c?.type === 'text').map((c) => c.text || '').join('');
  if (!text) throw new Error('Tool call did not return text content');
  return JSON.parse(text);
}

async function listAllTools(client) {
  const tools = [];
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const response = await client.send('tools/list', cursor ? { cursor } : {});
    if (response.error) throw new Error(`tools/list failed: ${response.error.message}`);
    tools.push(...(response.result?.tools || []));
    cursor = response.result?.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

async function main() {
  console.log('Running scene_3d build scaffolding MCP test...');

  const server = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: process.cwd(),
    env: { ...process.env, GOPEAK_TOOL_PROFILE: 'compact' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => { stderr += chunk; });

  const cleanup = async () => {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([new Promise((r) => server.once('exit', r)), delay(2000)]);
      if (server.exitCode === null) {
        server.kill('SIGKILL');
        await Promise.race([new Promise((r) => server.once('exit', r)), delay(2000)]);
      }
    }
  };

  try {
    await delay(500);
    assert(server.exitCode === null, 'Server process is running', 'Server exited during startup');

    const client = new StdioJsonRpcClient(server);
    const init = await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'build-scaffolding-test', version: '1.0.0' },
    });
    assert(!init.error, 'initialize succeeded', `initialize failed: ${init.error?.message || 'unknown error'}`);
    client.notify('notifications/initialized');

    // Step 3: Verify scene_3d tools absent in compact profile
    const initialToolNames = new Set((await listAllTools(client)).map((t) => t.name));
    const scene3dNames = ['add_mesh_instance', 'setup_camera_3d', 'setup_lighting', 'setup_environment', 'set_material_3d', 'add_gridmap'];
    assert(
      scene3dNames.every((n) => !initialToolNames.has(sanitizeToolName(n))),
      'scene_3d tools are absent from initial compact profile tools/list',
      `Found unexpected scene_3d tools in initial list: ${scene3dNames.filter((n) => initialToolNames.has(sanitizeToolName(n))).join(', ')}`,
    );

    // Step 4: Activate via tool.catalog
    const catalogPayload = parseToolCallJson(await client.send('tools/call', { name: 'tool.catalog', arguments: { query: '3d lighting' } }));
    assert(
      Array.isArray(catalogPayload.newlyActivated) && catalogPayload.newlyActivated.includes('scene_3d'),
      'tool.catalog auto-activates scene_3d for query "3d lighting"',
      `Expected newlyActivated to include scene_3d, got: ${JSON.stringify(catalogPayload.newlyActivated)}`,
    );
    assert(
      Array.isArray(catalogPayload.activeGroups) && catalogPayload.activeGroups.includes('scene_3d'),
      'tool.catalog reports scene_3d as active',
      `Expected activeGroups to include scene_3d, got: ${JSON.stringify(catalogPayload.activeGroups)}`,
    );

    // Step 5: Re-list and confirm all 6 tools exposed
    const postTools = await listAllTools(client);
    const postNames = new Set(postTools.map((t) => t.name));
    assert(
      scene3dNames.every((n) => postNames.has(sanitizeToolName(n))),
      'After activation, all 6 scene_3d tools are exposed',
      `Missing scene_3d tools: ${scene3dNames.filter((n) => !postNames.has(sanitizeToolName(n))).join(', ')}`,
    );

    // Step 6: Schema spot-checks per tool
    const byName = new Map(postTools.map((t) => [t.name, t]));
    const reqHas = (tool, ...fields) => fields.every((f) => tool?.inputSchema?.required?.includes(f));

    const addMesh = byName.get(sanitizeToolName('add_mesh_instance'));
    assert(addMesh?.inputSchema?.type === 'object', 'add_mesh_instance inputSchema.type is object', 'add_mesh_instance inputSchema.type mismatch');
    assert(reqHas(addMesh, 'projectPath', 'scenePath'), 'add_mesh_instance required has projectPath+scenePath', `add_mesh_instance required: ${JSON.stringify(addMesh?.inputSchema?.required)}`);
    assert(addMesh?.inputSchema?.properties?.meshType?.enum !== undefined, 'add_mesh_instance has meshType enum', 'add_mesh_instance missing meshType enum');

    const setupCam = byName.get(sanitizeToolName('setup_camera_3d'));
    assert(setupCam?.inputSchema?.type === 'object', 'setup_camera_3d inputSchema.type is object', 'setup_camera_3d inputSchema.type mismatch');
    assert(reqHas(setupCam, 'projectPath', 'scenePath'), 'setup_camera_3d required has projectPath+scenePath', `setup_camera_3d required: ${JSON.stringify(setupCam?.inputSchema?.required)}`);
    assert(setupCam?.inputSchema?.properties?.fov !== undefined && setupCam?.inputSchema?.properties?.projection !== undefined, 'setup_camera_3d has fov and projection', 'setup_camera_3d missing fov or projection');

    const setupLit = byName.get(sanitizeToolName('setup_lighting'));
    assert(setupLit?.inputSchema?.type === 'object', 'setup_lighting inputSchema.type is object', 'setup_lighting inputSchema.type mismatch');
    assert(reqHas(setupLit, 'projectPath', 'scenePath'), 'setup_lighting required has projectPath+scenePath', `setup_lighting required: ${JSON.stringify(setupLit?.inputSchema?.required)}`);
    const ltEnum = setupLit?.inputSchema?.properties?.lightType?.enum;
    assert(Array.isArray(ltEnum) && ltEnum.includes('directional') && ltEnum.includes('omni') && ltEnum.includes('spot'), 'setup_lighting lightType enum has directional|omni|spot', `setup_lighting lightType enum: ${JSON.stringify(ltEnum)}`);

    const setupEnv = byName.get(sanitizeToolName('setup_environment'));
    assert(setupEnv?.inputSchema?.type === 'object', 'setup_environment inputSchema.type is object', 'setup_environment inputSchema.type mismatch');
    assert(reqHas(setupEnv, 'projectPath', 'scenePath'), 'setup_environment required has projectPath+scenePath', `setup_environment required: ${JSON.stringify(setupEnv?.inputSchema?.required)}`);
    assert(setupEnv?.inputSchema?.properties?.backgroundMode?.enum !== undefined, 'setup_environment has backgroundMode enum', 'setup_environment missing backgroundMode enum');

    const setMat = byName.get(sanitizeToolName('set_material_3d'));
    assert(setMat?.inputSchema?.type === 'object', 'set_material_3d inputSchema.type is object', 'set_material_3d inputSchema.type mismatch');
    assert(reqHas(setMat, 'projectPath', 'scenePath', 'nodePath'), 'set_material_3d required has projectPath+scenePath+nodePath', `set_material_3d required: ${JSON.stringify(setMat?.inputSchema?.required)}`);
    assert(setMat?.inputSchema?.properties?.materialProperties?.type === 'object', 'set_material_3d has materialProperties object', 'set_material_3d missing materialProperties object');

    const addGrid = byName.get(sanitizeToolName('add_gridmap'));
    assert(addGrid?.inputSchema?.type === 'object', 'add_gridmap inputSchema.type is object', 'add_gridmap inputSchema.type mismatch');
    assert(reqHas(addGrid, 'projectPath', 'scenePath'), 'add_gridmap required has projectPath+scenePath', `add_gridmap required: ${JSON.stringify(addGrid?.inputSchema?.required)}`);
    assert(addGrid?.inputSchema?.properties?.cells?.type === 'array', 'add_gridmap has cells array property', 'add_gridmap missing cells array');

    // Step 7: Dispatch to non-existent project — expect any non-success (bridge connect failure)
    let dispatchResponse;
    let timedOut = false;
    try {
      dispatchResponse = await client.send('tools/call', {
        name: sanitizeToolName('add_mesh_instance'),
        arguments: { projectPath: '/nonexistent/project', scenePath: 'foo.tscn', parentNodePath: '.', nodeName: 'X', meshType: 'box' },
      }, 20000);
    } catch {
      timedOut = true;
    }

    if (timedOut) {
      pass('add_mesh_instance dispatch with non-existent project returned non-success (timed out, bridge unavailable)');
    } else {
      let isNonSuccess = !!dispatchResponse?.error;
      if (!isNonSuccess) {
        try {
          const payload = parseToolCallJson(dispatchResponse);
          isNonSuccess = payload?.success !== true && payload?.ok !== true;
        } catch { isNonSuccess = true; }
      }
      assert(isNonSuccess, 'add_mesh_instance with non-existent project returns non-success (bridge connect failure expected)', 'add_mesh_instance unexpectedly reported success for non-existent project');
    }

    console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
    if (failCount > 0) process.exitCode = 1;
  } catch (error) {
    fail(`Unhandled test error: ${error?.message || String(error)}`);
    console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
    process.exitCode = 1;
  } finally {
    await cleanup();
    if (stderr.trim()) {
      console.log('\n[Server stderr excerpt]');
      console.log(stderr.trim().split('\n').slice(-10).join('\n'));
    }
  }
}

await main();
