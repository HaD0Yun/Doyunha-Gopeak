import { readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listTestRuns, readTestRunRaw } from './tools/test_reports.js';

const STATIC_RESOURCES = [
  {
    uri: 'godot://project/info',
    name: 'Project Info',
    description: 'Parsed Godot project.godot metadata as JSON.',
    mimeType: 'application/json',
  },
  {
    uri: 'godot://test-runs',
    name: 'Test Runs Index',
    description: 'List of test scenario runs persisted under .gopeak/test-runs/.',
    mimeType: 'application/json',
  },
];

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'godot://scene/{path}',
    name: 'Scene File',
    description: 'Read a Godot scene (.tscn) file from the current project.',
    mimeType: 'text/plain',
  },
  {
    uriTemplate: 'godot://script/{path}',
    name: 'GDScript File',
    description: 'Read a GDScript (.gd) file from the current project.',
    mimeType: 'text/x-gdscript',
  },
  {
    uriTemplate: 'godot://resource/{path}',
    name: 'Resource File',
    description: 'Read a project resource file (.tres, .tscn, .gd).',
    mimeType: 'text/plain',
  },
  {
    uriTemplate: 'godot://test-run/{id}',
    name: 'Test Run Record',
    description: 'A persisted run_test_scenario JSON report under .gopeak/test-runs/.',
    mimeType: 'application/json',
  },
];

type ParsedGodotUri =
  | { kind: 'project-info' }
  | { kind: 'test-runs' }
  | { kind: 'test-run'; id: string }
  | { kind: 'scene' | 'script' | 'resource'; resourcePath: string };

function ensureProjectPath(getProjectPath: () => string | null): string {
  const projectPath = getProjectPath();
  if (!projectPath) {
    throw new Error('Project path is not set. Set a Godot project path first.');
  }

  return resolve(projectPath);
}

function validateRelativePath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/').trim().replace(/^\/+/, '');
  if (!normalized) {
    throw new Error('Resource path is empty.');
  }

  if (normalized.includes('..')) {
    throw new Error('Invalid resource path: directory traversal is not allowed.');
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Invalid resource path.');
  }

  return normalized;
}

function resolveProjectFile(projectPath: string, resourcePath: string): string {
  const fullPath = resolve(projectPath, resourcePath);
  const relativePath = relative(projectPath, fullPath);

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Resolved file path escapes project directory.');
  }

  return fullPath;
}

function parseGodotUri(uri: string): ParsedGodotUri {
  if (uri === 'godot://project/info') {
    return { kind: 'project-info' };
  }
  if (uri === 'godot://test-runs') {
    return { kind: 'test-runs' };
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid URI: ${uri}`);
  }

  if (parsed.protocol !== 'godot:') {
    throw new Error(`Unsupported URI scheme: ${parsed.protocol}`);
  }

  const host = parsed.hostname;
  if (host === 'test-run') {
    const id = decodeURIComponent(parsed.pathname).replace(/^\/+/, '').trim();
    if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
      throw new Error('Invalid test-run id.');
    }
    return { kind: 'test-run', id };
  }
  if (host !== 'scene' && host !== 'script' && host !== 'resource') {
    throw new Error(`Unsupported Godot resource type: ${host}`);
  }

  const resourcePath = validateRelativePath(decodeURIComponent(parsed.pathname));

  return { kind: host, resourcePath };
}

function ensureAllowedExtension(kind: 'scene' | 'script' | 'resource', filePath: string): void {
  const extension = extname(filePath).toLowerCase();

  if (kind === 'scene' && extension !== '.tscn') {
    throw new Error('Scene resources must use .tscn extension.');
  }

  if (kind === 'script' && extension !== '.gd') {
    throw new Error('Script resources must use .gd extension.');
  }

  if (kind === 'resource' && !['.tres', '.tscn', '.gd'].includes(extension)) {
    throw new Error('Resource URIs support only .tres, .tscn, and .gd files.');
  }
}

function parseProjectGodot(content: string): Record<string, Record<string, string | number | boolean | null>> {
  const result: Record<string, Record<string, string | number | boolean | null>> = {};
  let currentSection = 'root';
  result[currentSection] = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim();
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    const rawValue = line.slice(eqIndex + 1).trim();

    result[currentSection][key] = parseIniLikeValue(rawValue);
  }

  return result;
}

function parseIniLikeValue(value: string): string | number | boolean | null {
  if (value === 'null') {
    return null;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (/^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  if (/^-?\d*\.\d+$/.test(value)) {
    return Number.parseFloat(value);
  }

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function readResourceText(uri: string, getProjectPath: () => string | null): { mimeType: string; text: string } {
  const projectPath = ensureProjectPath(getProjectPath);
  const parsedUri = parseGodotUri(uri);

  if (parsedUri.kind === 'project-info') {
    const projectFilePath = resolveProjectFile(projectPath, 'project.godot');
    const rawProject = readFileSync(projectFilePath, 'utf-8');
    const parsedProject = parseProjectGodot(rawProject);

    return {
      mimeType: 'application/json',
      text: JSON.stringify(parsedProject, null, 2),
    };
  }

  if (parsedUri.kind === 'test-runs') {
    const runs = listTestRuns(projectPath).map((entry) => ({
      id: entry.id,
      uri: `godot://test-run/${entry.id}`,
      mtime: entry.mtime,
      size: entry.size,
    }));
    return { mimeType: 'application/json', text: JSON.stringify({ runs }, null, 2) };
  }

  if (parsedUri.kind === 'test-run') {
    return readTestRunRaw(projectPath, parsedUri.id);
  }

  const filePath = resolveProjectFile(projectPath, parsedUri.resourcePath);
  ensureAllowedExtension(parsedUri.kind, filePath);
  const text = readFileSync(filePath, 'utf-8');

  return {
    mimeType: parsedUri.kind === 'script' ? 'text/x-gdscript' : 'text/plain',
    text,
  };
}

export function setupResourceHandlers(server: Server, getProjectPath: () => string | null): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: STATIC_RESOURCES,
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: RESOURCE_TEMPLATES,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    try {
      const { mimeType, text } = readResourceText(uri, getProjectPath);

      return {
        contents: [
          {
            uri,
            mimeType,
            text,
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to read resource '${uri}': ${error.message}`);
      }

      throw new Error(`Failed to read resource '${uri}'.`);
    }
  });
}
