import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  createScriptFile,
  deleteFunction,
  findUsages,
  modifyFunction,
  modifySignal,
  modifyVariable,
  refreshMap,
  resolvePath,
} from './gdscript_parser.js';
import type { GodotBridge } from './godot-bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let wss: WebSocketServer | null = null;
let currentProjectPath: string | null = null;
let currentBridge: GodotBridge | null = null;

const DEFAULT_VISUALIZER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Godot MCP Visualizer</title>
  </head>
  <body>
    <h1>Godot MCP Visualizer</h1>
    <p>Run the map_project tool to load visualization data.</p>
  </body>
</html>`;

const handleVisualizerConnectionRef = (socket: WebSocket): void => {
  handleVisualizerConnection(socket);
};

const onToolStart = (event: { tool: string; id: string; args: Record<string, unknown> }) => {
  broadcastToVisualizer({
    type: 'tool_event',
    event: 'start',
    ...event,
  });
};

const onToolEnd = (event: { tool: string; id: string; success: boolean; duration: number }) => {
  broadcastToVisualizer({
    type: 'tool_event',
    event: 'end',
    ...event,
  });
};

const onGodotConnected = (event: { projectPath?: string }) => {
  broadcastToVisualizer({
    type: 'connection_event',
    event: 'godot_connected',
    ...event,
  });
};

const onGodotDisconnected = () => {
  broadcastToVisualizer({
    type: 'connection_event',
    event: 'godot_disconnected',
  });
};

export function setProjectPath(projectPath: string): void {
  currentProjectPath = projectPath;
  const snapshot = readGitSnapshot(projectPath);
  if (snapshot) {
    lastGitSnapshotByProject.set(projectPath, snapshot);
  } else {
    lastGitSnapshotByProject.delete(projectPath);
  }
}

export async function serveVisualization(projectData: unknown, bridge: GodotBridge): Promise<string> {
  if (wss) {
    wss.off('connection', handleVisualizerConnectionRef);
  }
  detachBridgeHandlers();

  const htmlPath = path.join(__dirname, 'visualizer.html');
  let html: string;
  try {
    html = fs.readFileSync(htmlPath, 'utf-8');
  } catch {
    throw new Error(`Visualizer HTML template not found at ${htmlPath}`);
  }

  const dataJson = JSON.stringify(projectData);
  html = html.replace('"%%PROJECT_DATA%%"', dataJson);

  bridge.setVisualizerHtml(html);
  currentBridge = bridge;

  wss = bridge.getVisualizerWss();
  if (!wss) {
    throw new Error('Visualizer WebSocket server is not initialized. Start Godot bridge first.');
  }

  wss.off('connection', handleVisualizerConnectionRef);
  wss.on('connection', handleVisualizerConnectionRef);

  bridge.on('tool_start', onToolStart);
  bridge.on('tool_end', onToolEnd);
  bridge.on('godot_connected', onGodotConnected);
  bridge.on('godot_disconnected', onGodotDisconnected);

  const url = `http://localhost:${bridge.getStatus().port}`;
  console.error(`[visualizer] Serving at ${url}`);
  openBrowser(url);
  return url;
}

function handleVisualizerConnection(ws: WebSocket): void {
  console.error('[visualizer] Browser connected via WebSocket');

  if (currentBridge) {
    ws.send(JSON.stringify({
      type: 'godot_status',
      status: currentBridge.getStatus(),
    }));
  }

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      const result = await handleInternalCommand(message);
      ws.send(JSON.stringify({ id: message.id, ...result }));
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      ws.send(JSON.stringify({ error: errMsg }));
    }
  });

  ws.on('close', () => {
    console.error('[visualizer] Browser disconnected');
  });
}

type CommandHandler = (projectPath: string, args: Record<string, unknown>) =>
  { ok: boolean; [key: string]: unknown };

function parseDiffHunks(diffText: string): {
  hunks: Array<{ startLine: number; endLine: number; header: string; lines: string[] }>;
  additions: number;
  deletions: number;
} {
  const hunks: Array<{ startLine: number; endLine: number; header: string; lines: string[] }> = [];
  let additions = 0;
  let deletions = 0;

  const hunkRegex = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/;
  const diffLines = diffText.split('\n');
  let currentHunk: { startLine: number; endLine: number; header: string; lines: string[] } | null = null;

  for (const line of diffLines) {
    const match = line.match(hunkRegex);
    if (match) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      const start = parseInt(match[1], 10);
      const count = match[2] ? parseInt(match[2], 10) : 1;
      currentHunk = { startLine: start, endLine: start + count - 1, header: match[3].trim(), lines: [] };
    } else if (currentHunk) {
      currentHunk.lines.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      }
      if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return { hunks, additions, deletions };
}

// Runs git without a shell; each argument is passed verbatim.
function runGit(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 5000 });
  } catch (error) {
    const stdout = (error as { stdout?: string | Buffer }).stdout;
    if (typeof stdout === 'string') {
      return stdout;
    }
    if (Buffer.isBuffer(stdout)) {
      return stdout.toString('utf-8');
    }
    throw error;
  }
}

interface ActionEntry {
  ts: string;
  command: string;
  filePath: string;
  details: Record<string, unknown>;
  reason?: string;
}

type GitStatusKind = 'modified' | 'added' | 'untracked';

const actionLog: ActionEntry[] = [];
const MAX_ACTION_LOG = 100;
const lastGitSnapshotByProject = new Map<string, Map<string, GitStatusKind>>();

function appendActionEntry(entry: ActionEntry): void {
  actionLog.push(entry);
  if (actionLog.length > MAX_ACTION_LOG) {
    actionLog.shift();
  }

  if (!wss) {
    return;
  }

  const msg = JSON.stringify({ type: 'action_event', entry });
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(msg);
    }
  });
}

function parseGitStatusLine(xy: string): GitStatusKind {
  if (xy === '??') {
    return 'untracked';
  }
  if (xy.includes('A')) {
    return 'added';
  }
  return 'modified';
}

function readGitSnapshot(projectPath: string): Map<string, GitStatusKind> | null {
  const gitDir = path.join(projectPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return null;
  }

  try {
    const raw = runGit(['status', '--porcelain'], projectPath);
    const snapshot = new Map<string, GitStatusKind>();

    for (const line of raw.split('\n')) {
      if (!line.trim()) {
        continue;
      }

      const xy = line.substring(0, 2);
      const filePath = line.substring(3).trim();
      const actualPath = filePath.includes(' -> ') ? filePath.split(' -> ')[1] : filePath;
      const resFilePath = 'res://' + actualPath;
      snapshot.set(resFilePath, parseGitStatusLine(xy));
    }

    return snapshot;
  } catch {
    return null;
  }
}

function recordExternalChanges(projectPath: string): void {
  const previous = lastGitSnapshotByProject.get(projectPath);
  const current = readGitSnapshot(projectPath);

  if (!current) {
    lastGitSnapshotByProject.delete(projectPath);
    return;
  }

  if (!previous) {
    lastGitSnapshotByProject.set(projectPath, current);
    return;
  }

  for (const [filePath, status] of current) {
    const prevStatus = previous.get(filePath);
    if (prevStatus === status) {
      continue;
    }

    appendActionEntry({
      ts: new Date().toISOString(),
      command: 'external_change_detected',
      filePath,
      details: {
        path: filePath,
        status,
      },
      reason: 'Detected during refresh',
    });
  }

  lastGitSnapshotByProject.set(projectPath, current);
}

const MUTATION_COMMANDS = new Set([
  'create_script_file',
  'modify_variable',
  'modify_signal',
  'modify_function',
  'modify_function_delete',
]);

const COMMAND_MAP: Record<string, CommandHandler> = {
  refresh_map: (pp, args) => {
    const result = refreshMap(pp, args) as { ok: boolean; [key: string]: unknown };
    if (result.ok) {
      recordExternalChanges(pp);
    }
    return result;
  },
  create_script_file: (pp, args) => createScriptFile(pp, args) as { ok: boolean; [key: string]: unknown },
  modify_variable: (pp, args) => modifyVariable(pp, args) as { ok: boolean; [key: string]: unknown },
  modify_signal: (pp, args) => modifySignal(pp, args) as { ok: boolean; [key: string]: unknown },
  modify_function: (pp, args) => modifyFunction(pp, args) as { ok: boolean; [key: string]: unknown },
  modify_function_delete: (pp, args) => deleteFunction(pp, args) as { ok: boolean; [key: string]: unknown },
  find_usages: (pp, args) => findUsages(pp, args) as { ok: boolean; [key: string]: unknown },
  get_action_log: (_pp, _args) => ({ ok: true, entries: actionLog }),
  get_file_diff: (pp, args) => {
    try {
      const requestPath = (args.path as string) || '';
      if (!requestPath) {
        return { ok: false, error: 'Missing required argument: path' };
      }

      const absolutePath = resolvePath(pp, requestPath);
      let diffText = runGit(['diff', 'HEAD', '--', absolutePath], pp);

      if (diffText.trim() === '' && fs.existsSync(absolutePath)) {
        const relPath = path.relative(pp, absolutePath);
        const untracked = runGit(['ls-files', '--others', '--exclude-standard', '--', relPath], pp);
        if (untracked.trim() !== '') {
          diffText = runGit(['diff', '--no-index', '--', '/dev/null', absolutePath], pp);
        }
      }

      const parsed = parseDiffHunks(diffText);
      return {
        ok: true,
        diff: {
          path: requestPath,
          hunks: parsed.hunks,
          summary: {
            additions: parsed.additions,
            deletions: parsed.deletions,
          },
        },
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: errMsg };
    }
  },
};

async function handleInternalCommand(message: {
  id?: number;
  command: string;
  args: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  const { command, args } = message;

  if (!currentProjectPath) {
    return { ok: false, error: 'No project path set. Call map_project first.' };
  }

  console.error(`[visualizer] Internal command: ${command}`);

  const handler = COMMAND_MAP[command];
  if (handler) {
    try {
      const result = handler(currentProjectPath, args);
      if (result.ok && MUTATION_COMMANDS.has(command)) {
        appendActionEntry({
          ts: new Date().toISOString(),
          command,
          filePath: (args.path as string) || '',
          details: { ...args },
          reason: (args.reason as string) || undefined,
        });
      }
      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: errMsg };
    }
  }

  return { ok: false, error: `Unknown command: ${command}` };
}

export function stopVisualizationServer(): void {
  if (wss) {
    wss.off('connection', handleVisualizerConnectionRef);
    wss = null;
  }
  if (currentBridge) {
    currentBridge.setVisualizerHtml(DEFAULT_VISUALIZER_HTML);
    detachBridgeHandlers();
    currentBridge = null;
    console.error('[visualizer] Server detached from unified bridge');
  }
}

function detachBridgeHandlers(): void {
  if (!currentBridge) {
    return;
  }
  currentBridge.off('tool_start', onToolStart);
  currentBridge.off('tool_end', onToolEnd);
  currentBridge.off('godot_connected', onGodotConnected);
  currentBridge.off('godot_disconnected', onGodotDisconnected);
}

function broadcastToVisualizer(message: Record<string, unknown>): void {
  if (!wss) {
    return;
  }

  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function openBrowser(url: string): void {
  // No shell on macOS/Linux. Windows needs cmd for the "start" builtin; the
  // URL is passed as its own argument and is built locally (localhost + port).
  const [cmd, cmdArgs] = process.platform === 'darwin' ? ['open', [url]]
                       : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
                       : ['xdg-open', [url]];
  execFile(cmd as string, cmdArgs as string[], (err) => {
    if (err) {
      console.error(`[visualizer] Could not open browser: ${err.message}`);
    }
  });
}
