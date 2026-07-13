#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fetchLatestVersion, compareSemver } from './src/cli/utils.ts';
import * as updater from './src/cli/update.ts';

const { installRelease } = updater;

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}/latest`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

// Given a newer, valid GitHub release response
// When the latest version is fetched
// Then its tag is parsed and compares newer than the installed version.
await withServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ tag_name: 'v2.4.0' }));
}, async (url) => {
  const latest = await fetchLatestVersion({ url, timeoutMs: 500 });
  assert.equal(latest, '2.4.0');
  assert.equal(compareSemver(latest ?? '', '2.3.9'), 1);
});

// Given a release equal to the installed version
// When the response is fetched and versions are compared
// Then no update is reported.
await withServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ tag_name: 'v2.3.9' }));
}, async (url) => {
  const latest = await fetchLatestVersion({ url, timeoutMs: 500 });
  assert.equal(latest, '2.3.9');
  assert.equal(compareSemver(latest ?? '', '2.3.9'), 0);
});

// Given valid stable, prerelease, and build-metadata versions
// When SemVer precedence is compared
// Then numeric identifiers and prerelease precedence follow SemVer 2.0.0.
assert.equal(compareSemver('2.4.0-beta.2', '2.4.0-beta.11'), -1);
assert.equal(compareSemver('2.4.0-beta.11', '2.4.0'), -1);
assert.equal(compareSemver('2.4.0+build.7', '2.4.0+build.9'), 0);

// Given malformed GitHub release tags
// When the release boundary parses them
// Then ambiguous prerelease identifiers and leading-zero core versions are rejected.
for (const malformedTag of ['v2.3.9...', 'v2.3.9-..', 'v02.3.9', 'v2.03.9', 'v2.3.09', 'v2.3.9-01']) {
  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ tag_name: malformedTag }));
  }, async (url) => {
    assert.equal(await fetchLatestVersion({ url, timeoutMs: 500 }), null, malformedTag);
  });
}

// Given malformed JSON from GitHub
// When the latest version is fetched
// Then the boundary rejects it without inventing a version.
await withServer((_request, response) => response.end('{broken'), async (url) => {
  assert.equal(await fetchLatestVersion({ url, timeoutMs: 500 }), null);
});

// Given a missing release endpoint
// When GitHub answers 404
// Then the update check returns no version.
await withServer((_request, response) => {
  response.writeHead(404);
  response.end('missing');
}, async (url) => {
  assert.equal(await fetchLatestVersion({ url, timeoutMs: 500 }), null);
});

// Given an endpoint that does not respond before the deadline
// When the update check times out
// Then it returns no version promptly.
await withServer(() => {}, async (url) => {
  const startedAt = Date.now();
  assert.equal(await fetchLatestVersion({ url, timeoutMs: 40 }), null);
  assert(Date.now() - startedAt < 500);
});

// Given an untrusted release version containing path traversal
// When installation is requested
// Then it is rejected before any download or subprocess can run.
await assert.rejects(() => installRelease('../../malicious'), /malformed/);

// Given an updater transport boundary
// When a release URL downgrades to plaintext HTTP
// Then it is rejected before a request is sent.
assert.equal(typeof updater.assertSecureReleaseUrl, 'function');
assert.throws(() => updater.assertSecureReleaseUrl('http://example.test/gopeak.tgz'), /HTTPS/i);

// Given a release body larger than its configured safety limit
// When it streams through the downloader
// Then the transfer is aborted instead of consuming unbounded disk space.
assert.equal(typeof updater.createDownloadLimiter, 'function');
await assert.rejects(
  () => pipeline(Readable.from([Buffer.alloc(5), Buffer.alloc(5)]), updater.createDownloadLimiter(8)),
  /size limit/i,
);

// Given a verified previous release and a verified replacement
// When Bun fails to install the replacement after removing the old package
// Then the updater restores the previous release before surfacing the failure.
assert.equal(typeof updater.replaceGlobalPackage, 'function');
const commands = [];
const fakeRunner = async (command, args) => {
  commands.push([command, ...args].join(' '));
  if (args.at(-1) === '/verified/new.tgz') return { code: 42, stdout: '', stderr: 'install failed' };
  return { code: 0, stdout: '', stderr: '' };
};
await assert.rejects(
  () => updater.replaceGlobalPackage({
    nextArchive: '/verified/new.tgz',
    rollbackArchive: '/verified/old.tgz',
  }, fakeRunner),
  /restored/i,
);
assert.deepEqual(commands, [
  'bun remove -g gopeak',
  'bun add -g /verified/new.tgz',
  'bun add -g /verified/old.tgz',
]);

// Given the requested release is already globally installed
// When the TypeScript updater evaluates the installation
// Then it returns before any download, removal, or installation command.
const sameVersionCommands = [];
const sameVersionRunner = async (command, args) => {
  sameVersionCommands.push([command, ...args].join(' '));
  if (args.join(' ') === 'pm ls -g') return { code: 0, stdout: '└── gopeak@999.0.0', stderr: '' };
  if (command === 'gopeak') return { code: 0, stdout: 'gopeak v999.0.0', stderr: '' };
  return { code: 99, stdout: '', stderr: 'unexpected mutation' };
};
await updater.installRelease('999.0.0', sameVersionRunner);
assert.deepEqual(sameVersionCommands, ['bun pm ls -g', 'gopeak version']);

console.log('GitHub update tests passed');
