import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative as relativePath, dirname, basename } from 'node:path';
import { collectFiles } from './fs_utils.js';

// ─── find_node_references ───────────────────────────────────────────

export interface NodeReference {
  scenePath: string;
  nodePath: string;
  nodeType: string;
  propertyContext?: string;
}

export interface FindNodeReferencesResult {
  ok: boolean;
  references?: NodeReference[];
  count?: number;
  error?: string;
}

export function findNodeReferences(
  projectPath: string,
  nodeName: string,
  options?: { scenePaths?: string[]; maxResults?: number }
): FindNodeReferencesResult {
  const maxResults = options?.maxResults ?? 500;
  const references: NodeReference[] = [];

  const sceneFiles = collectFiles(projectPath, projectPath, ['tscn'], (rel) => {
    if (options?.scenePaths && options.scenePaths.length > 0) {
      return options.scenePaths.some(sp => rel.includes(sp));
    }
    return true;
  });

  const searchLower = nodeName.toLowerCase();

  for (const sceneFile of sceneFiles) {
    if (references.length >= maxResults) break;

    let content: string;
    try {
      content = readFileSync(sceneFile, 'utf-8');
    } catch {
      continue;
    }

    const resPath = 'res://' + relativePath(projectPath, sceneFile).replace(/\\/g, '/');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      const nameMatch = line.match(/^\[node.*?name="([^"]+)"/);
      if (!nameMatch) continue;

      const candidateName = nameMatch[1];
      if (candidateName !== nodeName && candidateName.toLowerCase() !== searchLower) continue;

      const typeMatch = line.match(/type="([^"]+)"/);
      const nodeType = typeMatch ? typeMatch[1] : 'Node';

      let parentPath = '';
      for (let j = i - 1; j >= 0 && j >= i - 30; j--) {
        const prev = lines[j].trim();
        if (prev.startsWith('[node') && prev.includes('name="')) {
          const pMatch = prev.match(/name="([^"]+)"/);
          if (pMatch) {
            parentPath = '/' + pMatch[1] + parentPath;
          }
        }
      }

      references.push({
        scenePath: resPath,
        nodePath: parentPath + '/' + candidateName,
        nodeType,
      });

      if (references.length >= maxResults) break;
    }
  }

  return { ok: true, references, count: references.length };
}

// ─── find_signal_connections ─────────────────────────────────────────

export interface SignalConnection {
  scenePath: string;
  sourceNode: string;
  signalName: string;
  targetNode: string;
  methodName: string;
  flags?: number;
  line?: number;
}

export interface FindSignalConnectionsResult {
  ok: boolean;
  connections?: SignalConnection[];
  count?: number;
  error?: string;
}

export function findSignalConnections(
  projectPath: string,
  options?: { signalName?: string; sourceNode?: string; targetNode?: string; scenePath?: string }
): FindSignalConnectionsResult {
  const result: SignalConnection[] = [];

  const sceneFiles = collectFiles(projectPath, projectPath, ['tscn'], (rel) => {
    if (options?.scenePath) return rel.includes(options.scenePath);
    return true;
  });

  for (const sceneFile of sceneFiles) {
    let content: string;
    try {
      content = readFileSync(sceneFile, 'utf-8');
    } catch {
      continue;
    }

    const resPath = 'res://' + relativePath(projectPath, sceneFile).replace(/\\/g, '/');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith('[connection')) continue;

      const signalMatch = line.match(/signal="([^"]+)"/);
      const toMatch = line.match(/to="([^"]+)"/);
      const methodMatch = line.match(/method="([^"]+)"/);
      const flagsMatch = line.match(/flags=(\d+)/);
      const fromMatch = line.match(/from="([^"]+)"/);

      if (!signalMatch || !toMatch) continue;

      const signalName = signalMatch[1];
      if (options?.signalName && signalName !== options.signalName) continue;

      const targetNode = toMatch[1];
      if (options?.targetNode && targetNode !== options.targetNode) continue;

      const sourceNode = fromMatch ? fromMatch[1] : '';

      if (options?.sourceNode && sourceNode !== options.sourceNode) continue;

      result.push({
        scenePath: resPath,
        sourceNode,
        signalName,
        targetNode,
        methodName: methodMatch ? methodMatch[1] : '',
        flags: flagsMatch ? parseInt(flagsMatch[1]) : undefined,
        line: i + 1,
      });
    }
  }

  return { ok: true, connections: result, count: result.length };
}

// ─── find_nodes_by_type ──────────────────────────────────────────────

export interface NodeTypeMatch {
  scenePath: string;
  nodePath: string;
  type: string;
}

export interface FindNodesByTypeResult {
  ok: boolean;
  nodes?: NodeTypeMatch[];
  count?: number;
  error?: string;
}

export function findNodesByType(
  projectPath: string,
  nodeType: string,
  options?: { scenePath?: string; recursive?: boolean }
): FindNodesByTypeResult {
  const results: NodeTypeMatch[] = [];
  const typeLower = nodeType.toLowerCase();

  const sceneFiles = collectFiles(projectPath, projectPath, ['tscn'], (rel) => {
    if (options?.scenePath) return rel.includes(options.scenePath);
    return true;
  });

  for (const sceneFile of sceneFiles) {
    let content: string;
    try {
      content = readFileSync(sceneFile, 'utf-8');
    } catch {
      continue;
    }

    const resPath = 'res://' + relativePath(projectPath, sceneFile).replace(/\\/g, '/');
    const lines = content.split('\n');

    let currentNodeName = '';
    let currentNodeType = '';
    let inNode = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('[node')) {
        if (currentNodeType && typeMatches(currentNodeType, typeLower) && currentNodeName) {
          results.push({ scenePath: resPath, nodePath: '/' + currentNodeName, type: currentNodeType });
        }
        const headerMatch = line.match(/name="([^"]+)"/);
        const typeHeaderMatch = line.match(/type="([^"]+)"/);
        currentNodeName = headerMatch ? headerMatch[1] : '';
        currentNodeType = typeHeaderMatch ? typeHeaderMatch[1] : '';
        inNode = true;
      } else if (inNode) {
        if (trimmed.startsWith('[') && !trimmed.startsWith('[ext_resource') && !trimmed.startsWith('[sub_resource') && !trimmed.startsWith('[node')) {
          inNode = false;
          if (currentNodeType && typeMatches(currentNodeType, typeLower) && currentNodeName) {
            results.push({ scenePath: resPath, nodePath: '/' + currentNodeName, type: currentNodeType });
          }
        }
      }
    }

    if (currentNodeType && typeMatches(currentNodeType, typeLower) && currentNodeName) {
      results.push({ scenePath: resPath, nodePath: '/' + currentNodeName, type: currentNodeType });
    }
  }

  return { ok: true, nodes: results, count: results.length };
}

function typeMatches(actual: string, search: string): boolean {
  return actual.toLowerCase() === search || actual.toLowerCase().includes(search);
}

// ─── cross_scene_set_property ────────────────────────────────────────

export interface CrossSceneSetPropertyResult {
  ok: boolean;
  updated?: number;
  failures?: Array<{ scenePath: string; error: string }>;
  error?: string;
}

export function crossSceneSetProperty(
  projectPath: string,
  nodePath: string,
  propertyName: string,
  propertyValue: unknown,
  options?: { scenePaths?: string[] }
): CrossSceneSetPropertyResult {
  const failures: Array<{ scenePath: string; error: string }> = [];
  let updated = 0;

  const sceneFiles = collectFiles(projectPath, projectPath, ['tscn'], (rel) => {
    if (options?.scenePaths && options.scenePaths.length > 0) {
      return options.scenePaths.some(sp => rel.includes(sp));
    }
    return true;
  });

  const nodeName = nodePath.split('/').pop() ?? nodePath;
  const valueStr = JSON.stringify(propertyValue);

  for (const sceneFile of sceneFiles) {
    let content: string;
    try {
      content = readFileSync(sceneFile, 'utf-8');
    } catch {
      failures.push({ scenePath: sceneFile, error: 'Cannot read file' });
      continue;
    }

    const resPath = 'res://' + relativePath(projectPath, sceneFile).replace(/\\/g, '/');

    const nodeNameRe = new RegExp(`\\[node.*?name="${escapeRegex(nodeName)}"[^\\]]*\\](?:[^[]|\\[(?!node\b))*`, 's');
    const nodeMatch = content.match(nodeNameRe);
    if (!nodeMatch) continue;

    if (nodeMatch[0].includes('=')) {
      const propRe = new RegExp(`^${escapeRegex(propertyName)}\\s*=\\s*.+$`, 'm');
      if (propRe.test(nodeMatch[0])) {
        content = content.replace(nodeMatch[0], nodeMatch[0].replace(propRe, `${propertyName} = ${valueStr}`));
      } else {
        const insertIdx = content.indexOf(nodeMatch[0]) + nodeMatch[0].length;
        content = content.slice(0, insertIdx) + `\n${propertyName} = ${valueStr}` + content.slice(insertIdx);
      }
    } else {
      const insertIdx = content.indexOf(nodeMatch[0]) + nodeMatch[0].length;
      content = content.slice(0, insertIdx) + `\n${propertyName} = ${valueStr}` + content.slice(insertIdx);
    }

    try {
      writeFileSync(sceneFile, content, 'utf-8');
      updated++;
    } catch (e) {
      failures.push({ scenePath: resPath, error: String(e) });
    }
  }

  return { ok: true, updated, failures: failures.length > 0 ? failures : undefined };
}

// ─── batch_set_property ──────────────────────────────────────────────

export interface BatchSetPropertyResult {
  ok: boolean;
  updated?: number;
  failures?: Array<{ scenePath: string; error: string }>;
  error?: string;
}

export function batchSetProperty(
  projectPath: string,
  nodePath: string,
  properties: Record<string, unknown>,
  options?: { scenePaths?: string[] }
): BatchSetPropertyResult {
  const failures: Array<{ scenePath: string; error: string }> = [];
  let updated = 0;

  const sceneFiles = collectFiles(projectPath, projectPath, ['tscn'], (rel) => {
    if (options?.scenePaths && options.scenePaths.length > 0) {
      return options.scenePaths.some(sp => rel.includes(sp));
    }
    return true;
  });

  const nodeName = nodePath.split('/').pop() ?? nodePath;

  for (const sceneFile of sceneFiles) {
    let content: string;
    try {
      content = readFileSync(sceneFile, 'utf-8');
    } catch {
      failures.push({ scenePath: sceneFile, error: 'Cannot read file' });
      continue;
    }

    const resPath = 'res://' + relativePath(projectPath, sceneFile).replace(/\\/g, '/');
    const nodeNameRe = new RegExp(`\\[node.*?name="${escapeRegex(nodeName)}"[^\\]]*\\](?:[^[]|\\[(?!node\b))*`, 's');
    const nodeMatch = content.match(nodeNameRe);
    if (!nodeMatch) continue;

    const nodeBlockStart = content.indexOf(nodeMatch[0]);
    const nodeBlockEnd = nodeBlockStart + nodeMatch[0].length;
    let nodeBlock = nodeMatch[0];

    for (const [propName, propValue] of Object.entries(properties)) {
      const valueStr = JSON.stringify(propValue);
      const propRe = new RegExp(`^${escapeRegex(propName)}\\s*=\\s*.+$`, 'm');
      if (propRe.test(nodeBlock)) {
        nodeBlock = nodeBlock.replace(propRe, `${propName} = ${valueStr}`);
      } else {
        const insertIdx = nodeBlock.length;
        nodeBlock = nodeBlock.slice(0, insertIdx) + `\n${propName} = ${valueStr}` + nodeBlock.slice(insertIdx);
      }
    }

    content = content.slice(0, nodeBlockStart) + nodeBlock + content.slice(nodeBlockEnd);

    try {
      writeFileSync(sceneFile, content, 'utf-8');
      updated++;
    } catch (e) {
      failures.push({ scenePath: resPath, error: String(e) });
    }
  }

  return { ok: true, updated, failures: failures.length > 0 ? failures : undefined };
}

// ─── get_scene_dependencies ──────────────────────────────────────────

export interface SceneDependency {
  scenePath: string;
  resources: string[];
  scenes: string[];
  scripts: string[];
}

export interface GetSceneDependenciesResult {
  ok: boolean;
  dependencies?: SceneDependency[];
  error?: string;
}

export function getSceneDependencies(
  projectPath: string,
  options?: { scenePath?: string }
): GetSceneDependenciesResult {
  const results: SceneDependency[] = [];

  const sceneFiles = collectFiles(projectPath, projectPath, ['tscn'], (rel) => {
    if (options?.scenePath) {
      const sp = options.scenePath.replace(/^res:\/\//, '');
      const normalizedRel = rel.replace(/\\/g, '/');
      return normalizedRel.includes(sp) || normalizedRel.endsWith(sp);
    }
    return true;
  });

  for (const sceneFile of sceneFiles) {
    let content: string;
    try {
      content = readFileSync(sceneFile, 'utf-8');
    } catch {
      continue;
    }

    const resPath = 'res://' + relativePath(projectPath, sceneFile).replace(/\\/g, '/');
    const resources: string[] = [];
    const scenes: string[] = [];
    const scripts: string[] = [];

    const extRe = /\[ext_resource[^\]]*path="([^"]+)"[^\]]*type="([^"]+)"[^\]]*\]|\[ext_resource[^\]]*type="([^"]+)"[^\]]*path="([^"]+)"[^\]]*\]/g;
    let m: RegExpExecArray | null;
    while ((m = extRe.exec(content)) !== null) {
      const path = m[1] || m[4];
      const type = m[2] || m[3];
      if (type === 'GDScript' || path.endsWith('.gd')) scripts.push(path);
      else if (path.endsWith('.tscn')) scenes.push(path);
      else resources.push(path);
    }

    results.push({ scenePath: resPath, resources, scenes, scripts });
  }

  return { ok: true, dependencies: results };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}