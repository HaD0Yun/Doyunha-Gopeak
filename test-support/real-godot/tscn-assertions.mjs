import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadTscn(projectPath, scenePath) {
  const relativePath = scenePath.replace(/^res:\/\//, '');
  const fullPath = resolve(projectPath, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Scene file not found: ${fullPath}`);
  }
  const content = readFileSync(fullPath, 'utf-8');
  return parseTscn(content);
}

export function loadFile(projectPath, filePath) {
  const relativePath = filePath.replace(/^res:\/\//, '');
  const fullPath = resolve(projectPath, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  return readFileSync(fullPath, 'utf-8');
}

export function parseTscn(content) {
  const lines = content.split('\n');
  const nodes = [];
  let currentNode = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('[node ') || trimmed === '[node]') {
      if (currentNode) nodes.push(currentNode);
      currentNode = { type: null, name: null, parent: null, properties: {} };
      for (const [, key, value] of trimmed.matchAll(/(\w+)="([^"]*)"/g)) {
        if (key === 'type') currentNode.type = value;
        else if (key === 'name') currentNode.name = value;
        else if (key === 'parent') currentNode.parent = value;
      }
    } else if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (currentNode) {
        nodes.push(currentNode);
        currentNode = null;
      }
    } else if (currentNode) {
      const equalIdx = trimmed.indexOf('=');
      if (equalIdx > 0) {
        const key = trimmed.slice(0, equalIdx).trim();
        const value = trimmed.slice(equalIdx + 1).trim();
        currentNode.properties[key] = value;
      }
    }
  }

  if (currentNode) nodes.push(currentNode);
  return { nodes, content, lines };
}

export function hasNode(tscn, type, name, parent = null) {
  return tscn.nodes.some((n) => {
    if (type && n.type !== type) return false;
    if (name && n.name !== `"${name}"` && n.name !== name) return false;
    if (parent && n.parent !== `"${parent}"` && n.parent !== parent) return false;
    return true;
  });
}

export function hasProperty(tscn, nodeName, key, expectedValue = null) {
  const node = tscn.nodes.find((n) => n.name === `"${nodeName}"` || n.name === nodeName);
  if (!node) return false;
  if (!(key in node.properties)) return false;
  if (expectedValue === null) return true;
  const actual = node.properties[key];
  if (actual === expectedValue || actual === `"${expectedValue}"`) return true;
  const expectedNum = Number(expectedValue);
  const actualNum = Number(actual);
  if (!Number.isNaN(expectedNum) && !Number.isNaN(actualNum) && expectedNum === actualNum) return true;
  return false;
}

export function getNodeProperty(tscn, nodeName, key) {
  const node = tscn.nodes.find((n) => n.name === `"${nodeName}"` || n.name === nodeName);
  if (!node) return null;
  return node.properties[key] || null;
}

export function countNodes(tscn, type = null, name = null) {
  return tscn.nodes.filter((n) => {
    if (type && n.type !== type) return false;
    if (name && n.name !== `"${name}"` && n.name !== name) return false;
    return true;
  }).length;
}

export function nodeExists(tscn, nodeName) {
  return tscn.nodes.some((n) => n.name === `"${nodeName}"` || n.name === nodeName);
}

// Returns true if a [sub_resource type="X"] block exists in the raw tscn content.
export function hasSubresourceType(tscn, type) {
  return tscn.content.includes(`[sub_resource type="${type}"`);
}

// Returns true if the tscn content contains the literal substring (for property line greps).
export function contentContains(tscn, substr) {
  return tscn.content.includes(substr);
}

// Returns the index of a node within its parent's children as they appear in the file.
// Lower index = appears earlier in file = lower sibling order.
export function getSiblingIndex(tscn, nodeName, parentName = null) {
  const siblings = tscn.nodes.filter((n) => {
    const nameMatch = n.name === `"${nodeName}"` || n.name === nodeName;
    if (parentName !== null) {
      const parentMatch = n.parent === `"${parentName}"` || n.parent === parentName || n.parent === '.';
      return !nameMatch && parentMatch;
    }
    return true;
  });
  // find the target node and its position among same-parent nodes
  const sameParentNodes = tscn.nodes.filter((n) => {
    if (parentName !== null) {
      return n.parent === `"${parentName}"` || n.parent === parentName || n.parent === '.';
    }
    return n.parent === '.';
  });
  return sameParentNodes.findIndex((n) => n.name === `"${nodeName}"` || n.name === nodeName);
}

// Returns true if node1 appears before node2 in the file (among all nodes, regardless of parent).
// Useful for verifying sibling order after move_node.
export function nodeComesBeforeInFile(tscn, name1, name2) {
  const idx1 = tscn.nodes.findIndex((n) => n.name === `"${name1}"` || n.name === name1);
  const idx2 = tscn.nodes.findIndex((n) => n.name === `"${name2}"` || n.name === name2);
  if (idx1 === -1 || idx2 === -1) return false;
  return idx1 < idx2;
}

// Returns true if a line matching the pattern exists as a property under the named node.
export function hasPropertyMatching(tscn, nodeName, key, valuePattern) {
  const node = tscn.nodes.find((n) => n.name === `"${nodeName}"` || n.name === nodeName);
  if (!node) return false;
  if (!(key in node.properties)) return false;
  const actual = node.properties[key];
  return typeof valuePattern === 'string' ? actual.includes(valuePattern) : valuePattern.test(actual);
}
