/**
 * GDScript Project Parser
 *
 * TypeScript port of visualizer_tools.gd from tomyud1/godot-mcp.
 * Crawls a Godot project directory and parses all GDScript files to build
 * a structural project map for the interactive visualizer.
 *
 * Key difference from the original: this runs on the filesystem directly
 * (Node.js fs) instead of using Godot's DirAccess/FileAccess APIs.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, basename, dirname, relative } from 'path';

// ─── Types ───────────────────────────────────────────────────────────

export interface ScriptVariable {
  name: string;
  type: string;
  exported: boolean;
  onready: boolean;
  default: string;
}

export interface ScriptFunction {
  name: string;
  params: string;
  return_type: string;
  line: number;
  body: string;
  body_lines: number;
}

export interface ScriptSignal {
  name: string;
  params: string;
}

export interface ScriptConnection {
  object?: string;
  signal: string;
  target: string;
  line: number;
}

export interface ScriptNode {
  path: string;        // res:// path
  filename: string;
  folder: string;
  category: string;    // e.g., "player", "audio", "network", "dungeon", "ui", "system", "utility"
  class_name: string;
  extends: string;
  description: string;
  line_count: number;
  variables: ScriptVariable[];
  functions: ScriptFunction[];
  signals: ScriptSignal[];
  preloads: string[];
  connections: ScriptConnection[];
  gitStatus: 'modified' | 'added' | 'untracked' | null;
}

export interface ProjectEdge {
  from: string;
  to: string;
  type: 'extends' | 'preload' | 'signal';
  signal_name?: string;
}

export interface CategoryInfo {
  id: string;       // e.g., "player"
  label: string;    // e.g., "Player"
  color: string;    // e.g., "#f38ba8"
  count: number;    // Number of scripts in this category
}

export interface ProjectMap {
  nodes: ScriptNode[];
  edges: ProjectEdge[];
  categories: CategoryInfo[];
  total_scripts: number;
  total_connections: number;
}

// Dynamic color palette — assigned to categories as they are discovered.
const CATEGORY_PALETTE = [
  '#f38ba8', '#fab387', '#89dceb', '#a6e3a1', '#cba6f7',
  '#f9e2af', '#94e2d5', '#7aa2f7', '#89b4fa', '#eba0ac',
  '#b4befe', '#74c7ec', '#f5c2e7', '#a6adc8', '#f2cdcd',
  '#cdd6f4', '#bac2de', '#94e2d5', '#fab387', '#89dceb',
];
const FALLBACK_COLOR = '#6c7086';

// Folder names that are generic containers, not meaningful categories.
// When a script sits under one of these, skip to the next subfolder.
const CONTAINER_FOLDERS = new Set([
  'scripts', 'src', 'code', 'source', 'gdscript', 'gd', 'lib', 'core',
]);

export interface MapProjectResult {
  ok: boolean;
  project_map?: ProjectMap;
  error?: string;
}

// ─── Main Entry ──────────────────────────────────────────────────────

/**
 * Crawl a Godot project and build a structural map of all scripts.
 * @param projectPath Absolute filesystem path to the Godot project root
 * @param rootRes     res:// sub-path to start from (default: "res://")
 * @param includeAddons Whether to include scripts in addons/ (default: false)
 */
export function mapProject(
  projectPath: string,
  rootRes: string = 'res://',
  includeAddons: boolean = false
): MapProjectResult {
  // Normalise rootRes
  if (!rootRes.startsWith('res://')) {
    rootRes = 'res://' + rootRes;
  }

  // Convert res:// to absolute path
  const rootAbsolute = resToAbsolute(projectPath, rootRes);
  if (!existsSync(rootAbsolute)) {
    return { ok: false, error: `Directory not found: ${rootAbsolute}` };
  }

  // 1. Collect all .gd files
  const scriptPaths: string[] = [];
  collectScripts(rootAbsolute, projectPath, scriptPaths, includeAddons);

  if (scriptPaths.length === 0) {
    return { ok: false, error: `No GDScript files found in ${rootRes}` };
  }

  // 2. Parse each script
  const nodes: ScriptNode[] = [];
  const classMap: Record<string, string> = {}; // class_name -> res:// path

  for (const absPath of scriptPaths) {
    const resPath = absoluteToRes(projectPath, absPath);
    const info = parseScript(absPath, resPath);
    nodes.push(info);
    if (info.class_name) {
      classMap[info.class_name] = resPath;
    }
  }

  const categoryCounts: Record<string, number> = {};
  for (const node of nodes) {
    node.category = categorizeScript(node);
    categoryCounts[node.category] = (categoryCounts[node.category] || 0) + 1;
  }

  // Build categories dynamically — colors assigned by descending count
  let colorIdx = 0;
  const categories: CategoryInfo[] = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({
      id,
      label: prettifyLabel(id),
      color: CATEGORY_PALETTE[colorIdx++ % CATEGORY_PALETTE.length] || FALLBACK_COLOR,
      count,
    }));

  const edges: ProjectEdge[] = [];
  for (const node of nodes) {
    const fromPath = node.path;

    // extends → class_name resolution OR direct res:// path
    if (node.extends) {
      if (node.extends.startsWith('res://')) {
        // File-based extends: extends "res://scripts/base.gd"
        edges.push({ from: fromPath, to: node.extends, type: 'extends' });
      } else if (classMap[node.extends]) {
        // Class name-based extends: extends MyBaseClass
        edges.push({ from: fromPath, to: classMap[node.extends], type: 'extends' });
      }
    }

    // preload/load references (all resource types, not just .gd)
    for (const ref of node.preloads) {
      edges.push({ from: fromPath, to: ref, type: 'preload' });
    }

    // signal connections
    for (const conn of node.connections) {
      if (conn.target && classMap[conn.target]) {
        edges.push({
          from: fromPath,
          to: classMap[conn.target],
          type: 'signal',
          signal_name: conn.signal,
        });
      }
    }
  }

  // ── Git status detection ────────────────────────────────────────────
  // Tag each node with git status: modified, added, untracked, or null.
  try {
    const gitDir = join(projectPath, '.git');
    if (existsSync(gitDir)) {
      const raw = execFileSync('git', ['status', '--porcelain'], {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      });
      const gitFileMap = new Map<string, 'modified' | 'added' | 'untracked'>();
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        const xy = line.substring(0, 2);
        const filePath = line.substring(3).trim();
        // Handle renamed files: "R  old -> new"
        const actualPath = filePath.includes(' -> ') ? filePath.split(' -> ')[1] : filePath;
        const resFilePath = 'res://' + actualPath;

        if (xy === '??') {
          gitFileMap.set(resFilePath, 'untracked');
        } else if (xy.includes('A')) {
          gitFileMap.set(resFilePath, 'added');
        } else {
          // M, MM, AM, etc. — treat as modified
          gitFileMap.set(resFilePath, 'modified');
        }
      }
      for (const node of nodes) {
        node.gitStatus = gitFileMap.get(node.path) ?? null;
      }
    }
  } catch {
    // Git not available or command failed — leave all gitStatus as null
  }

  return {
    ok: true,
    project_map: {
      nodes,
      edges,
      categories,
      total_scripts: nodes.length,
      total_connections: edges.length,
    },
  };
}

// ─── File Collection ─────────────────────────────────────────────────

function collectScripts(
  dirPath: string,
  projectRoot: string,
  results: string[],
  includeAddons: boolean
): void {
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return;
  }

  for (const name of entries) {
    if (name.startsWith('.')) continue;

    const fullPath = join(dirPath, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }

    if (st.isDirectory()) {
      if (name === 'addons' && !includeAddons) continue;
      collectScripts(fullPath, projectRoot, results, includeAddons);
    } else if (name.endsWith('.gd')) {
      results.push(fullPath);
    }
  }
}

// ─── Script Parser ───────────────────────────────────────────────────

function parseScript(absolutePath: string, resPath: string): ScriptNode {
  let content: string;
  try {
    content = readFileSync(absolutePath, 'utf-8');
  } catch {
    return emptyNode(resPath);
  }

  const lines = content.split('\n');
  const lineCount = lines.length;

  let description = '';
  let extendsClass = '';
  let classNameStr = '';
  const variables: ScriptVariable[] = [];
  const functions: ScriptFunction[] = [];
  const signalsList: ScriptSignal[] = [];
  const preloads: string[] = [];
  const connections: ScriptConnection[] = [];

  // Regex patterns (JS equivalents of the GDScript RegEx)
  const reDesc = /^##\s*@desc:\s*(.+)/;
  const reExtends = /^extends\s+(\w+)/;
  const reExtendsPath = /^extends\s+"(res:\/\/[^"]+)"/;
  const reClassName = /^class_name\s+(\w+)/;
  const reVar = /^(@export(?:\([^)]*\))?\s+)?(@onready\s+)?var\s+(\w+)\s*(?::\s*(\w+))?(?:\s*=\s*(.+))?/;
  const reFunc = /^func\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\w+))?/;
  const reSignal = /^signal\s+(\w+)(?:\(([^)]*)\))?/;
  const rePreload = /(?:preload|load)\s*\(\s*"(res:\/\/[^"]+)"\s*\)/;
  const reConnectObj = /(\w+)\.(\w+)\.connect\s*\(/;
  const reConnectDirect = /^\s*(\w+)\.connect\s*\(/;

  // Variable type map for signal connection resolution
  const varTypeMap: Record<string, string> = {};

  // Track function start positions
  const funcStarts: Array<{ lineIdx: number; name: string }> = [];

  // ── First pass: extract metadata ──
  for (let i = 0; i < lineCount; i++) {
    const line = lines[i];
    const stripped = line.trim();

    // Description tag (first 15 lines)
    if (i < 15 && !description) {
      const m = stripped.match(reDesc);
      if (m) { description = m[1]; continue; }
    }

    // extends (class name or file path)
    if (!extendsClass) {
      const mPath = stripped.match(reExtendsPath);
      if (mPath) { extendsClass = mPath[1]; continue; }
      const m = stripped.match(reExtends);
      if (m) { extendsClass = m[1]; continue; }
    }

    // class_name
    if (!classNameStr) {
      const m = stripped.match(reClassName);
      if (m) { classNameStr = m[1]; continue; }
    }

    // Variables — only top-level (not indented)
    if (!line.startsWith('\t') && !line.startsWith(' ')) {
      const mVar = stripped.match(reVar);
      if (mVar) {
        const exported = (mVar[1] || '').trim() !== '';
        const onready = (mVar[2] || '').trim() !== '';
        const varName = mVar[3];
        let varType = (mVar[4] || '').trim();
        const defaultVal = (mVar[5] || '').trim();

        if (!varType && defaultVal) {
          varType = inferType(defaultVal);
        }
        if (varType) {
          varTypeMap[varName] = varType;
        }

        variables.push({
          name: varName,
          type: varType,
          exported,
          onready,
          default: defaultVal,
        });
      }
    }

    // Functions
    const mFunc = stripped.match(reFunc);
    if (mFunc) {
      const funcName = mFunc[1];
      const returnType = (mFunc[3] || '').trim();
      funcStarts.push({ lineIdx: i, name: funcName });
      functions.push({
        name: funcName,
        params: (mFunc[2] || '').trim(),
        return_type: returnType,
        line: i + 1,
        body: '',
        body_lines: 0,
      });
    }

    // Signals
    const mSig = stripped.match(reSignal);
    if (mSig) {
      signalsList.push({
        name: mSig[1],
        params: (mSig[2] || '').trim(),
      });
    }

    // Preload / load references
    const mPreload = stripped.match(rePreload);
    if (mPreload) {
      preloads.push(mPreload[1]);
    }

    // Signal connections (Godot 4 style)
    const mConnObj = stripped.match(reConnectObj);
    if (mConnObj) {
      const objName = mConnObj[1];
      const signalName = mConnObj[2];
      const targetType = varTypeMap[objName] || '';
      connections.push({
        object: objName,
        signal: signalName,
        target: targetType,
        line: i + 1,
      });
    } else {
      const mConnDirect = stripped.match(reConnectDirect);
      if (mConnDirect) {
        connections.push({
          signal: mConnDirect[1],
          target: extendsClass,
          line: i + 1,
        });
      }
    }
  }

  // ── Second pass: extract function bodies ──
  for (let fi = 0; fi < funcStarts.length; fi++) {
    const startIdx = funcStarts[fi].lineIdx;
    let endIdx = fi + 1 < funcStarts.length
      ? funcStarts[fi + 1].lineIdx
      : lineCount;

    // Trim trailing blank lines
    while (endIdx > startIdx + 1 && lines[endIdx - 1].trim() === '') {
      endIdx--;
    }

    // Check for top-level declarations that end the function body
    for (let ci = startIdx + 1; ci < endIdx; ci++) {
      const checkLine = lines[ci];
      if (
        checkLine !== '' &&
        !checkLine.startsWith('\t') &&
        !checkLine.startsWith(' ') &&
        !checkLine.startsWith('#')
      ) {
        endIdx = ci;
        break;
      }
    }

    let body = lines.slice(startIdx, endIdx).join('\n');
    if (body.length > 3000) {
      body = body.substring(0, 3000) + '\n# ... (truncated)';
    }

    functions[fi].body = body;
    functions[fi].body_lines = endIdx - startIdx;
  }

  // Folder / filename
  const folder = dirname(resPath);
  const filename = basename(resPath);

  return {
    path: resPath,
    filename,
    folder,
    category: 'other',
    class_name: classNameStr,
    extends: extendsClass,
    description,
    line_count: lineCount,
    variables,
    functions,
    signals: signalsList,
    preloads,
    connections,
    gitStatus: null,
  };
}

// ─── Type Inference ──────────────────────────────────────────────────

function inferType(defaultVal: string): string {
  if (defaultVal === 'true' || defaultVal === 'false') return 'bool';
  if (/^-?\d+$/.test(defaultVal)) return 'int';
  if (/^-?\d+\.\d+$/.test(defaultVal)) return 'float';
  if (defaultVal.startsWith('"') || defaultVal.startsWith("'")) return 'String';
  if (defaultVal.startsWith('Vector2')) return 'Vector2';
  if (defaultVal.startsWith('Vector3')) return 'Vector3';
  if (defaultVal.startsWith('Color')) return 'Color';
  if (defaultVal.startsWith('[')) return 'Array';
  if (defaultVal.startsWith('{')) return 'Dictionary';
  if (defaultVal === 'null') return 'Variant';
  if (defaultVal.endsWith('.new()')) return defaultVal.replace('.new()', '');
  return '';
}

/**
 * Categorise a script by its folder structure.
 * Uses the first meaningful subfolder (skipping generic containers like scripts/, src/).
 * Works for ANY Godot project — no hardcoded game-specific keywords.
 */
function categorizeScript(node: ScriptNode): string {
  const resPath = node.path.replace(/^res:\/\//, '');
  const segments = resPath.split('/').filter(Boolean);

  // Remove filename (last segment)
  const folders = segments.slice(0, -1);

  if (folders.length === 0) return 'root';

  // Find first folder that is NOT a generic container
  for (const folder of folders) {
    if (!CONTAINER_FOLDERS.has(folder.toLowerCase())) {
      return folder.toLowerCase();
    }
  }

  // All folders were containers — use the deepest one
  return folders[folders.length - 1].toLowerCase();
}

/** Turn a folder slug into a readable label: my_cool_scripts → My Cool Scripts */
function prettifyLabel(slug: string): string {
  return slug
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Path Helpers ────────────────────────────────────────────────────

function resToAbsolute(projectRoot: string, resPath: string): string {
  const relPath = resPath.replace(/^res:\/\//, '');
  return join(projectRoot, relPath);
}

function absoluteToRes(projectRoot: string, absPath: string): string {
  const rel = relative(projectRoot, absPath).replace(/\\/g, '/');
  return 'res://' + rel;
}

function emptyNode(resPath: string): ScriptNode {
  return {
    path: resPath,
    filename: basename(resPath),
    folder: dirname(resPath),
    category: 'other',
    class_name: '',
    extends: '',
    description: '',
    line_count: 0,
    variables: [],
    functions: [],
    signals: [],
    preloads: [],
    connections: [],
    gitStatus: null,
  };
}

// ─── Internal Edit Commands (filesystem-based) ───────────────────────
// These replace the GodotBridge-based commands from tomyud1.
// The browser sends WebSocket commands → visualizer-server routes here.

/**
 * Convert a res:// path to an absolute filesystem path.
 */
export function resolvePath(projectPath: string, resOrRelPath: string): string {
  if (resOrRelPath.startsWith('res://')) {
    return resToAbsolute(projectPath, resOrRelPath);
  }
  return join(projectPath, resOrRelPath);
}

/**
 * Refresh the project map (re-crawl).
 */
export function refreshMap(projectPath: string, args: Record<string, unknown>): MapProjectResult {
  const root = (args.root as string) || 'res://';
  const includeAddons = (args.include_addons as boolean) || false;
  return mapProject(projectPath, root, includeAddons);
}

/**
 * Create a new script file.
 */
export function createScriptFile(
  projectPath: string,
  args: Record<string, unknown>
): { ok: boolean; path?: string; error?: string } {
  let scriptPath = (args.path as string) || '';
  const extendsType = (args.extends as string) || 'Node';
  const classNameStr = (args.class_name as string) || '';

  if (!scriptPath) return { ok: false, error: 'No path provided' };

  if (!scriptPath.startsWith('res://')) {
    scriptPath = 'res://' + scriptPath;
  }
  if (!scriptPath.endsWith('.gd')) {
    scriptPath += '.gd';
  }

  const absPath = resToAbsolute(projectPath, scriptPath);

  if (existsSync(absPath)) {
    return { ok: false, error: `File already exists: ${scriptPath}` };
  }

  // Create directory if needed
  const dir = dirname(absPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let content = '';
  if (classNameStr) content += `class_name ${classNameStr}\n`;
  content += `extends ${extendsType}\n\n\n`;
  content += `func _ready() -> void:\n\tpass\n`;

  writeFileSync(absPath, content, 'utf-8');
  return { ok: true, path: scriptPath };
}

/**
 * Add, update, or delete a variable in a script file.
 */
export function modifyVariable(
  projectPath: string,
  args: Record<string, unknown>
): { ok: boolean; action?: string; variable?: string; error?: string } {
  const scriptPath = args.path as string;
  const action = args.action as string; // "add" | "update" | "delete"
  const oldName = (args.old_name as string) || '';
  const newName = (args.name as string) || '';
  const varType = (args.type as string) || '';
  const defaultVal = (args.default as string) || '';
  const exported = (args.exported as boolean) || false;
  const onready = (args.onready as boolean) || false;

  if (!scriptPath) return { ok: false, error: 'No script path provided' };

  const absPath = resolvePath(projectPath, scriptPath);
  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return { ok: false, error: `Cannot open file: ${scriptPath}` };
  }

  const lines = content.split('\n');
  let modified = false;

  if (action === 'delete') {
    const pattern = new RegExp(
      `^(@export(?:\\([^)]*\\))?\\s+)?(?:@onready\\s+)?var\\s+${oldName}\\s*(?::|=|$)`
    );
    for (let i = lines.length - 1; i >= 0; i--) {
      if (pattern.test(lines[i].trim())) {
        lines.splice(i, 1);
        modified = true;
        break;
      }
    }
  } else if (action === 'update') {
    const pattern = new RegExp(
      `^(@export(?:\\([^)]*\\))?\\s+)?(@onready\\s+)?var\\s+${oldName}\\s*(?::\\s*\\w+)?(?:\\s*=\\s*.+)?$`
    );
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i].trim())) {
        lines[i] = buildVarLine(newName, varType, defaultVal, exported, onready);
        modified = true;
        break;
      }
    }
  } else if (action === 'add') {
    const insertPos = findVarInsertPosition(lines, exported);
    lines.splice(insertPos, 0, buildVarLine(newName, varType, defaultVal, exported, false));
    modified = true;
  }

  if (modified) {
    writeFileSync(absPath, lines.join('\n'), 'utf-8');
    return { ok: true, action, variable: newName || oldName };
  }
  return { ok: false, error: `Variable not found: ${oldName}` };
}

/**
 * Add, update, or delete a signal in a script file.
 */
export function modifySignal(
  projectPath: string,
  args: Record<string, unknown>
): { ok: boolean; action?: string; signal?: string; error?: string } {
  const scriptPath = args.path as string;
  const action = args.action as string;
  const oldName = (args.old_name as string) || '';
  const newName = (args.name as string) || '';
  const params = (args.params as string) || '';

  if (!scriptPath) return { ok: false, error: 'No script path provided' };

  const absPath = resolvePath(projectPath, scriptPath);
  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return { ok: false, error: `Cannot open file: ${scriptPath}` };
  }

  const lines = content.split('\n');
  let modified = false;

  if (action === 'delete') {
    const pattern = new RegExp(`^signal\\s+${oldName}(?:\\s*\\(|$)`);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (pattern.test(lines[i].trim())) {
        lines.splice(i, 1);
        modified = true;
        break;
      }
    }
  } else if (action === 'update') {
    const pattern = new RegExp(`^signal\\s+${oldName}(?:\\s*\\([^)]*\\))?$`);
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i].trim())) {
        let newLine = `signal ${newName}`;
        if (params) newLine += `(${params})`;
        lines[i] = newLine;
        modified = true;
        break;
      }
    }
  } else if (action === 'add') {
    const insertPos = findSignalInsertPosition(lines);
    let newLine = `signal ${newName}`;
    if (params) newLine += `(${params})`;
    lines.splice(insertPos, 0, newLine);
    modified = true;
  }

  if (modified) {
    writeFileSync(absPath, lines.join('\n'), 'utf-8');
    return { ok: true, action, signal: newName || oldName };
  }
  return { ok: false, error: `Signal not found: ${oldName}` };
}

/**
 * Update a function's body in a script file.
 */
export function modifyFunction(
  projectPath: string,
  args: Record<string, unknown>
): { ok: boolean; function?: string; error?: string } {
  const scriptPath = args.path as string;
  const funcName = args.name as string;
  const newBody = args.body as string;

  if (!scriptPath || !funcName) {
    return { ok: false, error: 'Missing path or function name' };
  }

  const absPath = resolvePath(projectPath, scriptPath);
  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return { ok: false, error: `Cannot open file: ${scriptPath}` };
  }

  const lines = content.split('\n');
  const reFuncStart = new RegExp(`^func\\s+${funcName}\\s*\\(`);

  let funcStart = -1;
  let funcEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (funcStart === -1) {
      if (reFuncStart.test(lines[i].trim())) {
        funcStart = i;
      }
    } else {
      const stripped = lines[i].trim();
      if (
        stripped !== '' &&
        !lines[i].startsWith('\t') &&
        !lines[i].startsWith(' ') &&
        !stripped.startsWith('#')
      ) {
        funcEnd = i;
        break;
      }
    }
  }

  if (funcStart === -1) {
    return { ok: false, error: `Function not found: ${funcName}` };
  }
  if (funcEnd === -1) funcEnd = lines.length;

  // Trim trailing blanks
  while (funcEnd > funcStart + 1 && lines[funcEnd - 1].trim() === '') {
    funcEnd--;
  }

  // Replace
  const newLines = newBody.split('\n');
  lines.splice(funcStart, funcEnd - funcStart, ...newLines);

  writeFileSync(absPath, lines.join('\n'), 'utf-8');
  return { ok: true, function: funcName };
}

/**
 * Delete a function from a script file.
 */
export function deleteFunction(
  projectPath: string,
  args: Record<string, unknown>
): { ok: boolean; deleted?: string; error?: string } {
  const scriptPath = args.path as string;
  const funcName = args.name as string;

  if (!scriptPath || !funcName) {
    return { ok: false, error: 'Missing path or function name' };
  }

  const absPath = resolvePath(projectPath, scriptPath);
  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return { ok: false, error: `Cannot open file: ${scriptPath}` };
  }

  const lines = content.split('\n');
  const reFuncStart = new RegExp(`^func\\s+${funcName}\\s*\\(`);

  let funcStart = -1;
  let funcEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (funcStart === -1) {
      if (reFuncStart.test(lines[i].trim())) {
        funcStart = i;
      }
    } else {
      const stripped = lines[i].trim();
      if (
        stripped !== '' &&
        !lines[i].startsWith('\t') &&
        !lines[i].startsWith(' ') &&
        !stripped.startsWith('#')
      ) {
        funcEnd = i;
        break;
      }
    }
  }

  if (funcStart === -1) {
    return { ok: false, error: `Function not found: ${funcName}` };
  }
  if (funcEnd === -1) funcEnd = lines.length;

  while (funcEnd > funcStart + 1 && lines[funcEnd - 1].trim() === '') {
    funcEnd--;
  }

  lines.splice(funcStart, funcEnd - funcStart);
  writeFileSync(absPath, lines.join('\n'), 'utf-8');
  return { ok: true, deleted: funcName };
}

/**
 * Find all usages of a symbol across all scripts.
 */
export function findUsages(
  projectPath: string,
  args: Record<string, unknown>
): { ok: boolean; usages?: Array<{ file: string; line: number; code: string }>; count?: number; error?: string } {
  const name = args.name as string;
  const itemType = (args.type as string) || ''; // "variable", "signal", "function"
  const rootRes = (args.root as string) || 'res://';

  if (!name) return { ok: false, error: 'No name provided' };

  const rootAbsolute = resToAbsolute(projectPath, rootRes);
  const scriptPaths: string[] = [];
  collectScripts(rootAbsolute, projectPath, scriptPaths, false);

  const usages: Array<{ file: string; line: number; code: string }> = [];
  const pattern = new RegExp(`\\b${name}\\b`);

  for (const absPath of scriptPaths) {
    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    const fileLines = content.split('\n');
    const resPath = absoluteToRes(projectPath, absPath);

    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      if (!pattern.test(line)) continue;

      // Skip declaration lines
      if (itemType === 'variable' && new RegExp(`^\\s*(@export)?\\s*var\\s+${name}\\b`).test(line)) continue;
      if (itemType === 'signal' && new RegExp(`^\\s*signal\\s+${name}\\b`).test(line)) continue;
      if (itemType === 'function' && new RegExp(`^\\s*func\\s+${name}\\s*\\(`).test(line)) continue;

      usages.push({
        file: resPath,
        line: i + 1,
        code: line.trim(),
      });
    }
  }

  return { ok: true, usages, count: usages.length };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildVarLine(
  name: string,
  type: string,
  defaultVal: string,
  exported: boolean,
  onready: boolean
): string {
  let line = '';
  if (exported) line += '@export ';
  if (onready) line += '@onready ';
  line += `var ${name}`;
  if (type) line += `: ${type}`;
  if (defaultVal) line += ` = ${defaultVal}`;
  return line;
}

function findVarInsertPosition(lines: string[], _exported: boolean): number {
  let lastVarLine = -1;
  let firstFuncLine = -1;
  let afterClassDecl = 0;

  const reVar = /^(@export)?\s*(@onready)?\s*var\s+/;
  const reFuncLine = /^func\s+/;
  const reClass = /^(class_name|extends)\s+/;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (reClass.test(stripped)) afterClassDecl = i + 1;
    if (reVar.test(stripped)) lastVarLine = i;
    if (reFuncLine.test(stripped) && firstFuncLine === -1) {
      firstFuncLine = i;
      break;
    }
  }

  if (lastVarLine !== -1) return lastVarLine + 1;
  if (firstFuncLine !== -1) return firstFuncLine;
  return Math.max(afterClassDecl, 2);
}

function findSignalInsertPosition(lines: string[]): number {
  let lastSignalLine = -1;
  let firstVarLine = -1;
  let afterClassDecl = 0;

  const reSignalLine = /^signal\s+/;
  const reVar = /^(@export)?\s*var\s+/;
  const reClass = /^(class_name|extends)\s+/;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (reClass.test(stripped)) afterClassDecl = i + 1;
    if (reSignalLine.test(stripped)) lastSignalLine = i;
    if (reVar.test(stripped) && firstVarLine === -1) firstVarLine = i;
  }

  if (lastSignalLine !== -1) return lastSignalLine + 1;
  if (firstVarLine !== -1) return firstVarLine;
  return Math.max(afterClassDecl, 2);
}
