import { sanitizeToolName } from './tool-name.mjs';

let nextId = 1;

function makeRequest(method, params = {}) {
  return { jsonrpc: '2.0', id: nextId++, method, params };
}

export class StdioJsonRpcClient {
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

export function parseToolCallJson(response) {
  if (response?.error) {
    throw new Error(response.error.message || 'Tool call returned JSON-RPC error');
  }
  if (response?.result?.isError) {
    const content = response?.result?.content;
    if (Array.isArray(content) && content.length > 0) {
      const text = content[0].text || '';
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* non-JSON error text */ }
      if (parsed !== null) {
        const errMsg = extractErrorMessage(parsed);
        if (errMsg) throw new Error(errMsg);
      }
      throw new Error(text || 'Tool call returned error response');
    }
    throw new Error('Tool call returned error response');
  }
  const content = response?.result?.content;
  if (!Array.isArray(content)) {
    const type = typeof content;
    let val = String(content);
    if (val.length > 200) val = val.slice(0, 200) + '...';
    throw new Error(`Tool call did not return content array: type=${type} value="${val}"`);
  }
  const text = content.filter((c) => c?.type === 'text').map((c) => c.text || '').join('');
  if (!text) {
    throw new Error('Tool call did not return text content');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (text.startsWith('error') || text.startsWith('Error') || text.includes('isError')) {
      throw new Error(text);
    }
    return text;
  }
  const errMsg = extractErrorMessage(parsed);
  if (errMsg) {
    throw new Error(errMsg);
  }
  return parsed;
}

function extractErrorMessage(parsed) {
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  if (parsed.error) {
    if (typeof parsed.error === 'string') {
      return parsed.error;
    }
    if (typeof parsed.error === 'object' && parsed.error !== null) {
      return parsed.error.message || parsed.error.message_ || JSON.stringify(parsed.error);
    }
  }
  if (parsed.success === false && parsed.message) {
    return parsed.message;
  }
  if (parsed.message && typeof parsed.message === 'string' && parsed.message.toLowerCase().includes('error')) {
    return parsed.message;
  }
  return null;
}

export { sanitizeToolName };