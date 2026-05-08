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
  console.log('Running scene_physics build scaffolding MCP test...');

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
      clientInfo: { name: 'physics-scaffolding-test', version: '1.0.0' },
    });
    assert(!init.error, 'initialize succeeded', `initialize failed: ${init.error?.message || 'unknown error'}`);
    client.notify('notifications/initialized');

    // Step 3: Verify scene_physics tools absent in compact profile
    const initialToolNames = new Set((await listAllTools(client)).map((t) => t.name));
    const physicsNames = ['setup_collision', 'setup_physics_body', 'add_raycast', 'set_physics_layers', 'get_physics_layers', 'get_collision_info'];
    assert(
      physicsNames.every((n) => !initialToolNames.has(sanitizeToolName(n))),
      'scene_physics tools are absent from initial compact profile tools/list',
      `Found unexpected scene_physics tools in initial list: ${physicsNames.filter((n) => initialToolNames.has(sanitizeToolName(n))).join(', ')}`,
    );

    // Step 4: Activate via tool.catalog
    const catalogPayload = parseToolCallJson(await client.send('tools/call', { name: 'tool.catalog', arguments: { query: 'physics collision' } }));
    assert(
      Array.isArray(catalogPayload.newlyActivated) && catalogPayload.newlyActivated.includes('scene_physics'),
      'tool.catalog auto-activates scene_physics for query "physics collision"',
      `Expected newlyActivated to include scene_physics, got: ${JSON.stringify(catalogPayload.newlyActivated)}`,
    );
    assert(
      Array.isArray(catalogPayload.activeGroups) && catalogPayload.activeGroups.includes('scene_physics'),
      'tool.catalog reports scene_physics as active',
      `Expected activeGroups to include scene_physics, got: ${JSON.stringify(catalogPayload.activeGroups)}`,
    );

    // Step 5: Re-list and confirm all 6 tools exposed
    const postTools = await listAllTools(client);
    const postNames = new Set(postTools.map((t) => t.name));
    assert(
      physicsNames.every((n) => postNames.has(sanitizeToolName(n))),
      'After activation, all 6 scene_physics tools are exposed',
      `Missing scene_physics tools: ${physicsNames.filter((n) => !postNames.has(sanitizeToolName(n))).join(', ')}`,
    );

    // Step 6: Schema spot-checks per tool
    const byName = new Map(postTools.map((t) => [t.name, t]));
    const reqHas = (tool, ...fields) => fields.every((f) => tool?.inputSchema?.required?.includes(f));

    const setupCol = byName.get(sanitizeToolName('setup_collision'));
    assert(setupCol?.inputSchema?.type === 'object', 'setup_collision inputSchema.type is object', 'setup_collision inputSchema.type mismatch');
    assert(reqHas(setupCol, 'projectPath', 'scenePath', 'parentNodePath', 'nodeName', 'shapeType'), 'setup_collision required has all fields', `setup_collision required: ${JSON.stringify(setupCol?.inputSchema?.required)}`);
    assert(setupCol?.inputSchema?.properties?.shapeType?.enum !== undefined, 'setup_collision has shapeType enum', 'setup_collision missing shapeType enum');

    const setupBody = byName.get(sanitizeToolName('setup_physics_body'));
    assert(setupBody?.inputSchema?.type === 'object', 'setup_physics_body inputSchema.type is object', 'setup_physics_body inputSchema.type mismatch');
    assert(reqHas(setupBody, 'projectPath', 'scenePath', 'parentNodePath', 'nodeName', 'bodyType'), 'setup_physics_body required has all fields', `setup_physics_body required: ${JSON.stringify(setupBody?.inputSchema?.required)}`);
    assert(setupBody?.inputSchema?.properties?.bodyType?.enum !== undefined, 'setup_physics_body has bodyType enum', 'setup_physics_body missing bodyType enum');

    const addRay = byName.get(sanitizeToolName('add_raycast'));
    assert(addRay?.inputSchema?.type === 'object', 'add_raycast inputSchema.type is object', 'add_raycast inputSchema.type mismatch');
    assert(reqHas(addRay, 'projectPath', 'scenePath', 'parentNodePath', 'nodeName'), 'add_raycast required has all fields', `add_raycast required: ${JSON.stringify(addRay?.inputSchema?.required)}`);

    const setLayers = byName.get(sanitizeToolName('set_physics_layers'));
    assert(setLayers?.inputSchema?.type === 'object', 'set_physics_layers inputSchema.type is object', 'set_physics_layers inputSchema.type mismatch');
    assert(reqHas(setLayers, 'projectPath', 'scenePath', 'nodePath'), 'set_physics_layers required has all fields', `set_physics_layers required: ${JSON.stringify(setLayers?.inputSchema?.required)}`);

    const getLayers = byName.get(sanitizeToolName('get_physics_layers'));
    assert(getLayers?.inputSchema?.type === 'object', 'get_physics_layers inputSchema.type is object', 'get_physics_layers inputSchema.type mismatch');
    assert(reqHas(getLayers, 'projectPath', 'scenePath', 'nodePath'), 'get_physics_layers required has all fields', `get_physics_layers required: ${JSON.stringify(getLayers?.inputSchema?.required)}`);

    const getInfo = byName.get(sanitizeToolName('get_collision_info'));
    assert(getInfo?.inputSchema?.type === 'object', 'get_collision_info inputSchema.type is object', 'get_collision_info inputSchema.type mismatch');
    assert(reqHas(getInfo, 'projectPath'), 'get_collision_info required has projectPath', `get_collision_info required: ${JSON.stringify(getInfo?.inputSchema?.required)}`);

    // Step 7: Dispatch to non-existent project — expect any non-success (bridge connect failure)
    let dispatchResponse;
    let timedOut = false;
    try {
      dispatchResponse = await client.send('tools/call', {
        name: sanitizeToolName('setup_physics_body'),
        arguments: { projectPath: '/nonexistent/project', scenePath: 'foo.tscn', parentNodePath: '.', nodeName: 'X', bodyType: 'static' },
      }, 20000);
    } catch {
      timedOut = true;
    }

    if (timedOut) {
      pass('setup_physics_body dispatch with non-existent project returned non-success (timed out, bridge unavailable)');
    } else {
      let isNonSuccess = !!dispatchResponse?.error;
      if (!isNonSuccess) {
        try {
          const payload = parseToolCallJson(dispatchResponse);
          isNonSuccess = payload?.success !== true && payload?.ok !== true;
        } catch { isNonSuccess = true; }
      }
      assert(isNonSuccess, 'setup_physics_body with non-existent project returns non-success (bridge connect failure expected)', 'setup_physics_body unexpectedly reported success for non-existent project');
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
