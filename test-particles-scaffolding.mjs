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
  console.log('Running scene_particles build scaffolding MCP test...');

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
      clientInfo: { name: 'particles-scaffolding-test', version: '1.0.0' },
    });
    assert(!init.error, 'initialize succeeded', `initialize failed: ${init.error?.message || 'unknown error'}`);
    client.notify('notifications/initialized');

    // Step 3: Verify scene_particles tools absent in compact profile
    const initialToolNames = new Set((await listAllTools(client)).map((t) => t.name));
    const particlesNames = ['create_particles', 'set_particle_material', 'set_particle_color_gradient', 'apply_particle_preset', 'get_particle_info'];
    assert(
      particlesNames.every((n) => !initialToolNames.has(sanitizeToolName(n))),
      'scene_particles tools are absent from initial compact profile tools/list',
      `Found unexpected scene_particles tools in initial list: ${particlesNames.filter((n) => initialToolNames.has(sanitizeToolName(n))).join(', ')}`,
    );

    // Step 4: Activate via tool.catalog
    const catalogPayload = parseToolCallJson(await client.send('tools/call', { name: 'tool.catalog', arguments: { query: 'particles fire' } }));
    assert(
      Array.isArray(catalogPayload.newlyActivated) && catalogPayload.newlyActivated.includes('scene_particles'),
      'tool.catalog auto-activates scene_particles for query "particles fire"',
      `Expected newlyActivated to include scene_particles, got: ${JSON.stringify(catalogPayload.newlyActivated)}`,
    );
    assert(
      Array.isArray(catalogPayload.activeGroups) && catalogPayload.activeGroups.includes('scene_particles'),
      'tool.catalog reports scene_particles as active',
      `Expected activeGroups to include scene_particles, got: ${JSON.stringify(catalogPayload.activeGroups)}`,
    );

    // Step 5: Re-list and confirm all 5 tools exposed
    const postTools = await listAllTools(client);
    const postNames = new Set(postTools.map((t) => t.name));
    assert(
      particlesNames.every((n) => postNames.has(sanitizeToolName(n))),
      'After activation, all 5 scene_particles tools are exposed',
      `Missing scene_particles tools: ${particlesNames.filter((n) => !postNames.has(sanitizeToolName(n))).join(', ')}`,
    );

    // Step 6: Schema spot-checks per tool
    const byName = new Map(postTools.map((t) => [t.name, t]));
    const reqHas = (tool, ...fields) => fields.every((f) => tool?.inputSchema?.required?.includes(f));

    const createPart = byName.get(sanitizeToolName('create_particles'));
    assert(createPart?.inputSchema?.type === 'object', 'create_particles inputSchema.type is object', 'create_particles inputSchema.type mismatch');
    assert(reqHas(createPart, 'projectPath', 'scenePath', 'nodeName'), 'create_particles required has projectPath+scenePath+nodeName', `create_particles required: ${JSON.stringify(createPart?.inputSchema?.required)}`);
    const ptEnum = createPart?.inputSchema?.properties?.particleType?.enum;
    assert(Array.isArray(ptEnum) && ptEnum.includes('GPUParticles3D') && ptEnum.includes('CPUParticles2D'), 'create_particles particleType enum has GPUParticles3D and CPUParticles2D', `create_particles particleType enum: ${JSON.stringify(ptEnum)}`);
    assert(createPart?.inputSchema?.properties?.emissionShape?.enum !== undefined, 'create_particles has emissionShape enum', 'create_particles missing emissionShape enum');

    const setPartMat = byName.get(sanitizeToolName('set_particle_material'));
    assert(setPartMat?.inputSchema?.type === 'object', 'set_particle_material inputSchema.type is object', 'set_particle_material inputSchema.type mismatch');
    assert(reqHas(setPartMat, 'projectPath', 'scenePath', 'nodePath'), 'set_particle_material required has projectPath+scenePath+nodePath', `set_particle_material required: ${JSON.stringify(setPartMat?.inputSchema?.required)}`);
    assert(setPartMat?.inputSchema?.properties?.materialProperties?.type === 'object', 'set_particle_material has materialProperties object', 'set_particle_material missing materialProperties object');

    const setGrad = byName.get(sanitizeToolName('set_particle_color_gradient'));
    assert(setGrad?.inputSchema?.type === 'object', 'set_particle_color_gradient inputSchema.type is object', 'set_particle_color_gradient inputSchema.type mismatch');
    assert(reqHas(setGrad, 'projectPath', 'scenePath', 'nodePath'), 'set_particle_color_gradient required has projectPath+scenePath+nodePath', `set_particle_color_gradient required: ${JSON.stringify(setGrad?.inputSchema?.required)}`);
    assert(setGrad?.inputSchema?.properties?.colors?.type === 'array', 'set_particle_color_gradient has colors array property', 'set_particle_color_gradient missing colors array');

    const applyPreset = byName.get(sanitizeToolName('apply_particle_preset'));
    assert(applyPreset?.inputSchema?.type === 'object', 'apply_particle_preset inputSchema.type is object', 'apply_particle_preset inputSchema.type mismatch');
    assert(reqHas(applyPreset, 'projectPath', 'scenePath', 'nodeName', 'preset'), 'apply_particle_preset required has projectPath+scenePath+nodeName+preset', `apply_particle_preset required: ${JSON.stringify(applyPreset?.inputSchema?.required)}`);
    const presetEnum = applyPreset?.inputSchema?.properties?.preset?.enum;
    assert(Array.isArray(presetEnum) && presetEnum.includes('fire') && presetEnum.includes('explosion'), 'apply_particle_preset preset enum includes fire and explosion', `apply_particle_preset preset enum: ${JSON.stringify(presetEnum)}`);

    const getInfo = byName.get(sanitizeToolName('get_particle_info'));
    assert(getInfo?.inputSchema?.type === 'object', 'get_particle_info inputSchema.type is object', 'get_particle_info inputSchema.type mismatch');
    assert(reqHas(getInfo, 'projectPath', 'scenePath', 'nodePath'), 'get_particle_info required has projectPath+scenePath+nodePath', `get_particle_info required: ${JSON.stringify(getInfo?.inputSchema?.required)}`);

    // Step 7: Dispatch to non-existent project — expect any non-success (bridge connect failure)
    let dispatchResponse;
    let timedOut = false;
    try {
      dispatchResponse = await client.send('tools/call', {
        name: sanitizeToolName('create_particles'),
        arguments: { projectPath: '/nonexistent/project', scenePath: 'foo.tscn', parentNodePath: '.', nodeName: 'X', particleType: 'CPUParticles3D' },
      }, 20000);
    } catch {
      timedOut = true;
    }

    if (timedOut) {
      pass('create_particles dispatch with non-existent project returned non-success (timed out, bridge unavailable)');
    } else {
      let isNonSuccess = !!dispatchResponse?.error;
      if (!isNonSuccess) {
        try {
          const payload = parseToolCallJson(dispatchResponse);
          isNonSuccess = payload?.success !== true && payload?.ok !== true;
        } catch { isNonSuccess = true; }
      }
      assert(isNonSuccess, 'create_particles with non-existent project returns non-success (bridge connect failure expected)', 'create_particles unexpectedly reported success for non-existent project');
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