#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`./${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const server = JSON.parse(read('server.json'));
const readme = read('README.md');
const migration = read('docs/migration-policy.md');
const releaseProcess = read('docs/release-process.md');
const changelog = read('CHANGELOG.md');
const escapedVersion = pkg.version.replaceAll('.', '\\.');
const currentRelease = changelog.match(new RegExp(`## \\[${escapedVersion}\\][\\s\\S]*?(?=\\n## \\[|$)`))?.[0] ?? '';
const currentDocs = [
  'README.md',
  'README-ko.md',
  'README-ja.md',
  'README-de.md',
  'README-pt_BR.md',
  'README-zh.md',
  'index.html',
  'CONTRIBUTING.md',
  'ROADMAP.md',
  'docs/architecture.md',
  'docs/platform-roadmap.md',
  'docs/release-process.md',
].map((path) => [path, read(path)]);

for (const [scriptName, command] of Object.entries(pkg.scripts ?? {})) {
  assert.doesNotMatch(
    command,
    /(?:^|\s)(?:node|npm|npx|bunx|bun\s+x)(?:\s|$)/,
    `${scriptName} should run through Bun without a hidden Node or registry-backed executable`,
  );
}

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
assert.match(
  readme,
  new RegExp(`releases/download/v?${escapedVersion}/gopeak-${escapedVersion}\\.tgz`),
  'README should install the versioned GitHub Release asset',
);
assert.match(readme, /bun add -g "\$PWD\/gopeak-/, 'README should install GoPeak with Bun using an absolute tarball path');
assert.match(
  readme,
  /git clone https:\/\/github\.com\/HaD0Yun\/Doyunha-Gopeak\.git\s+cd Doyunha-Gopeak/,
  'README clone examples should enter the canonical checkout directory',
);

for (const [path, contents] of currentDocs) {
  assert.doesNotMatch(contents, /\bnpx\b/i, `${path} should not contain current npx instructions`);
  assert.doesNotMatch(contents, /\bnpm\s+(?:i|install|update|publish|pack|run)\b/i, `${path} should not contain current npm commands`);
  assert.doesNotMatch(contents, /npmjs\.com/i, `${path} should not link to the npm registry`);
  assert.doesNotMatch(contents, /bun publish/i, `${path} should never claim releases use bun publish`);
  assert.doesNotMatch(contents, /Node\.js\s+18/i, `${path} should not require Node.js for the Bun distribution`);
  assert.doesNotMatch(contents, /cd Gopeak-godot-mcp/, `${path} should not enter the retired repository directory`);
}

assert.match(currentRelease, /GitHub Release/i, 'current changelog entry should describe GitHub Release distribution');
assert.match(currentRelease, /Bun/i, 'current changelog entry should describe Bun installation');
assert.doesNotMatch(currentRelease, /\b(?:npm|npx)\b.*\b(?:install|update|publish|release)\b/i, 'current changelog entry should not claim a registry install or release flow');

for (const required of ['Old surface', 'New surface', 'Change type', 'Profile impact', 'Alias window', 'Verification']) {
  assert.match(migration, new RegExp(required), `migration policy should define ${required}`);
}

for (const gate of ['optional-runtime', 'optional-lsp', 'optional-dap', 'optional-network', 'workflow layer']) {
  assert.match(migration, new RegExp(gate.replace(' ', '\\s+'), 'i'), `migration policy should mention ${gate}`);
}

for (const legacyFlag of ['--dir', '--godot', '--configure']) {
  assert.match(migration, new RegExp(legacyFlag), `migration policy should map legacy installer flag ${legacyFlag}`);
}

assert.match(migration, /2\.3\.x/, 'legacy installer flags should have an explicit 2.3.x compatibility window');
assert.match(
  migration,
  /does not (?:publish to|contact) the npm registry/i,
  'migration policy should state that release installation is registry-free',
);
assert.match(
  releaseProcess,
  /gh attestation verify .*gopeak-X\.Y\.Z\.tgz.*--repo HaD0Yun\/Doyunha-Gopeak/i,
  'release docs should show GitHub artifact attestation verification',
);
assert.match(releaseProcess, /SHA-256[\s\S]*attestation/i, 'release docs should distinguish checksum and provenance verification');

console.log('docs/package migration policy checks passed');
