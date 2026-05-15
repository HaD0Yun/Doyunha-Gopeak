import { sleep } from './godot-process.mjs';

export async function waitForBridge(client, target = 'editor', timeoutMs = 60000) {
  const start = Date.now();
  const intervalMs = 1000;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await client.send('tools/call', {
        name: 'get_editor_status',
        arguments: {},
      }, 5000);

      const result = parseToolResult(response);
      if (result && result.connected === true) {
        return true;
      }
    } catch {
      // bridge not ready yet
    }
    await sleep(intervalMs);
  }

  throw new Error(`Bridge (${target}) did not connect within ${timeoutMs}ms`);
}

export async function waitForRuntime(client, timeoutMs = 30000) {
  const start = Date.now();
  const intervalMs = 500;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await client.send('tools/call', {
        name: 'get_runtime_status',
        arguments: {},
      }, 5000);

      const result = parseToolResult(response);
      if (result && result.connected === true) {
        return true;
      }
    } catch {
      // runtime not ready yet
    }
    await sleep(intervalMs);
  }

  throw new Error(`Runtime did not connect within ${timeoutMs}ms`);
}

function parseToolResult(response) {
  if (response?.error) return null;
  const text = (response?.result?.content || [])
    .filter((c) => c?.type === 'text')
    .map((c) => c.text || '')
    .join('');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}