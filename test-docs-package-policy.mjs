#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`./${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const server = JSON.parse(read('server.json'));
const readme = read('README.md');
const migration = read('docs/migration-policy.md');

for (const [source, description] of [
  ['package.json', pkg.description],
  ['server.json', server.description],
]) {
  assert.match(description, /trusted Godot 4 workflows/i, `${source} description should emphasize trusted Godot 4 workflows`);
  assert.doesNotMatch(description, /110\+ tools/i, `${source} description should not market raw 110+ tool count`);
}

assert.match(readme, /Migration & Deprecation Policy/, 'README should include migration/deprecation policy section');
assert.match(readme, /setup-gated/i, 'README should label optional capabilities as setup-gated');
assert.match(readme, /TileMapLayer/, 'README should document Godot 4.3+ TileMapLayer migration risk');
assert.doesNotMatch(readme, /110-tool context bombs/i, 'README should avoid raw tool-count marketing language');
assert.doesNotMatch(readme, /110\+ tools available/i, 'README should avoid raw tool-count value claim');

for (const required of ['Old surface', 'New surface', 'Change type', 'Profile impact', 'Alias window', 'Verification']) {
  assert.match(migration, new RegExp(required), `migration policy should define ${required}`);
}

for (const gate of ['optional-runtime', 'optional-lsp', 'optional-dap', 'optional-network', 'workflow layer']) {
  assert.match(migration, new RegExp(gate.replace(' ', '\\s+'), 'i'), `migration policy should mention ${gate}`);
}

console.log('docs/package migration policy checks passed');
