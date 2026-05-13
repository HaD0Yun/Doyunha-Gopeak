import { readFileSync } from 'node:fs';
import { relative as relativePath } from 'node:path';
import { collectFiles } from './fs_utils.js';

// ─── find_unused_resources ──────────────────────────────────────────

export interface UnusedResource {
  path: string;
  reason: string;
  usedBy?: string[];
}

export interface FindUnusedResourcesResult {
  ok: boolean;
  unused?: UnusedResource[];
  count?: number;
  error?: string;
}

export function findUnusedResources(
  projectPath: string,
  options?: { resourceTypes?: string[]; checkScenes?: boolean; checkScripts?: boolean }
): FindUnusedResourcesResult {
  const checkScenes = options?.checkScenes ?? true;
  const checkScripts = options?.checkScripts ?? true;
  const resourceTypes = options?.resourceTypes;

  const allResources: Set<string> = new Set();
  const usages: Set<string> = new Set();

  const sceneFiles = collectFiles(projectPath, projectPath, ['tscn']);
  const scriptFiles = collectFiles(projectPath, projectPath, ['gd']);
  const resourceFiles = collectFiles(projectPath, projectPath, ['tres', 'tresorig']);

  for (const f of resourceFiles) {
    const relPath = 'res://' + relativePath(projectPath, f).replace(/\\/g, '/');
    if (resourceTypes && !resourceTypes.some(rt => f.endsWith('.' + rt))) continue;
    allResources.add(relPath);
  }

  const allTextFiles = [...sceneFiles, ...scriptFiles];
  for (const f of allTextFiles) {
    let content: string;
    try {
      content = readFileSync(f, 'utf-8');
    } catch {
      continue;
    }

    const fileRel = 'res://' + relativePath(projectPath, f).replace(/\\/g, '/');
    usages.add(fileRel);

    const preloadRe = /(?:preload|load)\s*\(\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = preloadRe.exec(content)) !== null) usages.add(m[1]);

    const extRe = /\[ext_resource.*?path="([^"]+)"/g;
    while ((m = extRe.exec(content)) !== null) usages.add(m[1]);

    const sceneInstanceRe = /(?:load|instance)\s*\(\s*"([^"]+\.tscn)"/g;
    while ((m = sceneInstanceRe.exec(content)) !== null) usages.add(m[1]);
  }

  const unused: UnusedResource[] = [];
  for (const res of allResources) {
    if (!usages.has(res) && !res.startsWith('res://.godot')) {
      unused.push({ path: res, reason: 'No references found in scenes or scripts' });
    }
  }

  return { ok: true, unused, count: unused.length };
}

// ─── analyze_signal_flow ────────────────────────────────────────────

export interface SignalFlowNode {
  node: string;
  type: 'emitter' | 'receiver';
  signals: string[];
  connections: number;
}

export interface SignalFlowEdge {
  from: string;
  to: string;
  signal: string;
  method: string;
  scenePath?: string;
}

export interface SignalFlowResult {
  ok: boolean;
  nodes?: SignalFlowNode[];
  edges?: SignalFlowEdge[];
  totalSignals?: number;
  totalConnections?: number;
  error?: string;
}

export function analyzeSignalFlow(
  projectPath: string,
  options?: { scenePath?: string }
): SignalFlowResult {
  const nodes: Map<string, SignalFlowNode> = new Map();
  const edges: SignalFlowEdge[] = [];

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
    const sceneSignals = new Set<string>();

    for (const line of lines) {
      const trimmed = line.trim();
      const connMatch = trimmed.match(/\[connection.*?signal="([^"]+)".*?to="([^"]+)".*?method="([^"]+)"/);
      if (connMatch) {
        const signal = connMatch[1];
        const target = connMatch[2];
        sceneSignals.add(signal);

        if (!nodes.has(target)) {
          nodes.set(target, { node: target, type: 'receiver', signals: [], connections: 0 });
        }
        const targetNode = nodes.get(target)!;
        targetNode.connections++;

        const fromMatch = trimmed.match(/from="([^"]+)"/);
        edges.push({
          from: fromMatch ? fromMatch[1] : 'Unknown',
          to: target,
          signal,
          method: connMatch[3],
          scenePath: resPath,
        });
      }
    }
  }

  return {
    ok: true,
    nodes: Array.from(nodes.values()),
    edges,
    totalSignals: edges.length,
    totalConnections: edges.length,
  };
}

// ─── analyze_scene_complexity ────────────────────────────────────────

export interface SceneComplexity {
  scenePath: string;
  nodeCount: number;
  depth: number;
  resourceCount: number;
  scriptCount: number;
  connectionCount: number;
  complexity: 'simple' | 'moderate' | 'complex';
}

export interface AnalyzeSceneComplexityResult {
  ok: boolean;
  scenes?: SceneComplexity[];
  error?: string;
}

export function analyzeSceneComplexity(
  projectPath: string,
  options?: { scenePath?: string; maxDepth?: number }
): AnalyzeSceneComplexityResult {
  const results: SceneComplexity[] = [];

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

    let nodeCount = 0;
    let maxDepth = 0;
    let resourceCount = 0;
    let scriptCount = 0;
    let connectionCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('[node')) {
        nodeCount++;
        const typeMatch = trimmed.match(/type="([^"]+)"/);
        if (typeMatch && (typeMatch[1] === 'GDScript' || typeMatch[1].toLowerCase().includes('script'))) {
          scriptCount++;
        }

        const parentMatch = trimmed.match(/parent="([^"]+)"/);
        if (parentMatch) {
          const depth = parentMatch[1].split('/').filter(p => p).length;
          maxDepth = Math.max(maxDepth, depth);
        }
      } else if (trimmed.startsWith('[ext_resource')) {
        resourceCount++;
      } else if (trimmed.startsWith('[sub_resource')) {
        resourceCount++;
      } else if (trimmed.startsWith('[connection')) {
        connectionCount++;
      }
    }

    let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
    const score = nodeCount + resourceCount * 0.5 + connectionCount * 2 + scriptCount * 3;
    if (score > 50) complexity = 'complex';
    else if (score > 15) complexity = 'moderate';

    results.push({
      scenePath: resPath,
      nodeCount,
      depth: maxDepth,
      resourceCount,
      scriptCount,
      connectionCount,
      complexity,
    });
  }

  results.sort((a, b) => {
    const score = (s: SceneComplexity) =>
      s.nodeCount + s.resourceCount + s.connectionCount + s.scriptCount * 3;
    return score(b) - score(a);
  });

  return { ok: true, scenes: results };
}

// ─── find_script_references ─────────────────────────────────────────

export interface ScriptReference {
  path: string;
  type: 'extends' | 'preload' | 'load' | 'signal_connect' | 'new_instance' | 'type_hint';
  line?: number;
  context?: string;
}

export interface FindScriptReferencesResult {
  ok: boolean;
  references?: ScriptReference[];
  count?: number;
  error?: string;
}

export function findScriptReferences(
  projectPath: string,
  scriptPath: string,
  options?: { includeInherited?: boolean }
): FindScriptReferencesResult {
  const references: ScriptReference[] = [];

  const sceneFiles = collectFiles(projectPath, projectPath, ['tscn']);
  const scriptFiles = collectFiles(projectPath, projectPath, ['gd']);

  const scriptRel = scriptPath.startsWith('res://') ? scriptPath : 'res://' + scriptPath;
  const scriptName = scriptRel.split('/').pop()?.replace('.gd', '') ?? scriptRel;

  for (const f of [...sceneFiles, ...scriptFiles]) {
    if (f.replace(/\\/g, '/').endsWith(scriptRel)) continue;

    let content: string;
    try {
      content = readFileSync(f, 'utf-8');
    } catch {
      continue;
    }

    const fileRel = 'res://' + relativePath(projectPath, f).replace(/\\/g, '/');
    const lines = content.split('\n');
    const seenLines = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes(scriptRel) || line.includes(scriptName + '.gd"') || line.includes(scriptName + '.gd(')) {
        if (seenLines.has(i)) continue;
        seenLines.add(i);
        let type: ScriptReference['type'] = 'load';
        const trimmed = line.trim();

        if (trimmed.startsWith('extends') && trimmed.includes(scriptName + '.gd"')) type = 'extends';
        else if (trimmed.includes('preload') && trimmed.includes(scriptRel)) type = 'preload';
        else if (trimmed.includes('.new()') && (trimmed.includes(scriptName + '.gd') || line.includes(scriptRel))) type = 'new_instance';
        else if (line.includes('connect') && line.includes(scriptRel)) type = 'signal_connect';

        let context = trimmed;
        if (trimmed.length > 120) context = trimmed.slice(0, 120) + '...';

        references.push({ path: fileRel, type, line: i + 1, context });
      }

      if ((line.includes(scriptName + '.') || line.includes(scriptName + '(')) && (line.includes(scriptRel) || line.includes(scriptName + '.gd'))) {
        if (seenLines.has(i)) continue;
        seenLines.add(i);
        const context = line.trim().length > 120 ? line.trim().slice(0, 120) + '...' : line.trim();
        references.push({ path: fileRel, type: 'type_hint', line: i + 1, context });
      }
    }
  }

  return { ok: true, references, count: references.length };
}

// ─── detect_circular_dependencies ──────────────────────────────────

export interface CircularDependency {
  path: string[];
  length: number;
}

export interface DetectCircularDependenciesResult {
  ok: boolean;
  cycles?: CircularDependency[];
  count?: number;
  error?: string;
}

export function detectCircularDependencies(
  projectPath: string,
  options?: { checkScripts?: boolean; checkScenes?: boolean }
): DetectCircularDependenciesResult {
  const graph = new Map<string, Set<string>>();
  const scriptFiles = collectFiles(projectPath, projectPath, ['gd']);

  for (const f of scriptFiles) {
    const resPath = 'res://' + relativePath(projectPath, f).replace(/\\/g, '/');
    let content: string;
    try {
      content = readFileSync(f, 'utf-8');
    } catch {
      continue;
    }

    const deps = new Set<string>();
    const preloadRe = /(?:preload|load)\s*\(\s*"([^"]+\.gd)"/g;
    let m: RegExpExecArray | null;
    while ((m = preloadRe.exec(content)) !== null) deps.add(m[1]);

    const extendsMatch = content.match(/^extends\s+"([^"]+\.gd)"/m);
    if (extendsMatch) deps.add(extendsMatch[1]);

    graph.set(resPath, deps);
  }

  const cycles: CircularDependency[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const deps = graph.get(node) ?? new Set();
    for (const dep of deps) {
      if (!visited.has(dep)) {
        dfs(dep);
      } else if (recursionStack.has(dep)) {
        const cycleStart = path.indexOf(dep);
        const cycle = path.slice(cycleStart);
        cycle.push(dep);
        cycles.push({ path: cycle, length: cycle.length - 1 });
      }
    }

    path.pop();
    recursionStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return { ok: true, cycles, count: cycles.length };
}

// ─── get_project_statistics ─────────────────────────────────────────

export interface ProjectStatistics {
  totalScenes: number;
  totalScripts: number;
  totalResources: number;
  totalLines: number;
  averageSceneNodes: number;
  averageScriptLines: number;
  largestScene: { path: string; nodes: number } | null;
  largestScript: { path: string; lines: number } | null;
  nodeTypeBreakdown: Record<string, number>;
  languageBreakdown: { gdscript: number; shaders: number };
  sceneComplexity: { simple: number; moderate: number; complex: number };
}

export interface GetProjectStatisticsResult {
  ok: boolean;
  statistics?: ProjectStatistics;
  error?: string;
}

export function getProjectStatistics(projectPath: string): GetProjectStatisticsResult {
  const sceneFiles = collectFiles(projectPath, projectPath, ['tscn']);
  const scriptFiles = collectFiles(projectPath, projectPath, ['gd']);
  const shaderFiles = collectFiles(projectPath, projectPath, ['gdshader', 'glsl']);
  const resourceFiles = collectFiles(projectPath, projectPath, ['tres', 'tresorig']);

  let totalLines = 0;
  let largestSceneNodes = 0;
  let largestScenePath = '';
  let largestScriptLines = 0;
  let largestScriptPath = '';
  let totalSceneNodes = 0;
  let totalScriptLines = 0;

  const nodeTypeCounts: Record<string, number> = {};
  const complexityCount = { simple: 0, moderate: 0, complex: 0 };

  for (const f of sceneFiles) {
    let content: string;
    try {
      content = readFileSync(f, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    let nodeCount = 0;
    let scriptCount = 0;
    let connectionCount = 0;

    for (const line of lines) {
      if (line.includes('[node')) nodeCount++;
      if (line.includes('[ext_resource') || line.includes('[sub_resource')) scriptCount++;
      if (line.includes('[connection')) connectionCount++;

      const typeMatch = line.match(/type="([^"]+)"/);
      if (typeMatch) {
        const t = typeMatch[1];
        nodeTypeCounts[t] = (nodeTypeCounts[t] || 0) + 1;
      }
    }

    totalLines += lines.length;
    totalSceneNodes += nodeCount;

    if (nodeCount > largestSceneNodes) {
      largestSceneNodes = nodeCount;
      largestScenePath = 'res://' + relativePath(projectPath, f).replace(/\\/g, '/');
    }

    const score = nodeCount + scriptCount * 0.5 + connectionCount * 2;
    if (score > 50) complexityCount.complex++;
    else if (score > 15) complexityCount.moderate++;
    else complexityCount.simple++;
  }

  for (const f of scriptFiles) {
    let content: string;
    try {
      content = readFileSync(f, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    totalLines += lines.length;
    totalScriptLines += lines.length;

    if (lines.length > largestScriptLines) {
      largestScriptLines = lines.length;
      largestScriptPath = 'res://' + relativePath(projectPath, f).replace(/\\/g, '/');
    }
  }

  const avgSceneNodes = sceneFiles.length > 0
    ? Math.round(totalSceneNodes / sceneFiles.length * 10) / 10
    : 0;
  const avgScriptLines = scriptFiles.length > 0
    ? Math.round(totalScriptLines / scriptFiles.length)
    : 0;

  const statistics: ProjectStatistics = {
    totalScenes: sceneFiles.length,
    totalScripts: scriptFiles.length,
    totalResources: resourceFiles.length,
    totalLines,
    averageSceneNodes: avgSceneNodes,
    averageScriptLines: avgScriptLines,
    largestScene: largestScenePath ? { path: largestScenePath, nodes: largestSceneNodes } : null,
    largestScript: largestScriptPath ? { path: largestScriptPath, lines: largestScriptLines } : null,
    nodeTypeBreakdown: Object.fromEntries(
      Object.entries(nodeTypeCounts).sort((a, b) => b[1] - a[1])
    ),
    languageBreakdown: {
      gdscript: scriptFiles.length,
      shaders: shaderFiles.length,
    },
    sceneComplexity: complexityCount,
  };

  return { ok: true, statistics };
}