import { createHash, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { get as httpsGet } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fetchLatestVersion, parseSemver, runCommand } from './utils.js';
import type { CommandResult } from './utils.js';

const REPOSITORY = 'HaD0Yun/Doyunha-Gopeak';
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_ARCHIVE_BYTES = 134_217_728;
const MAX_CHECKSUM_BYTES = 4_096;

type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;

type GlobalReplacement = {
  readonly nextArchive: string;
  readonly rollbackArchive?: string;
};

class ReleaseDownloadError extends Error {
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = 'ReleaseDownloadError';
    this.url = url;
  }
}

export function assertSecureReleaseUrl(value: string | URL): URL {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== 'https:') {
    throw new ReleaseDownloadError('release downloads require HTTPS', url.href);
  }
  return url;
}

export function createDownloadLimiter(maxBytes: number): Transform {
  let receivedBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxBytes) {
        callback(new ReleaseDownloadError(`release download exceeded the ${maxBytes}-byte size limit`, 'response body'));
        return;
      }
      callback(null, chunk);
    },
  });
}

function openReleaseUrl(url: URL, redirectsRemaining: number, maxBytes: number): Promise<IncomingMessage> {
  const secureUrl = assertSecureReleaseUrl(url);
  return new Promise((resolve, reject) => {
    const outgoing = httpsGet(secureUrl, { headers: { 'User-Agent': 'gopeak-updater' } }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectsRemaining === 0) {
          reject(new ReleaseDownloadError('too many release download redirects', secureUrl.href));
          return;
        }
        let redirectUrl: URL;
        try {
          redirectUrl = assertSecureReleaseUrl(new URL(location, secureUrl));
        } catch (error) {
          reject(error);
          return;
        }
        openReleaseUrl(redirectUrl, redirectsRemaining - 1, maxBytes).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new ReleaseDownloadError(`release download returned HTTP ${status}`, secureUrl.href));
        return;
      }
      const contentLength = response.headers['content-length'];
      if (contentLength && Number(contentLength) > maxBytes) {
        response.resume();
        reject(new ReleaseDownloadError(`release download exceeded the ${maxBytes}-byte size limit`, secureUrl.href));
        return;
      }
      resolve(response);
    });
    outgoing.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      outgoing.destroy(new ReleaseDownloadError('release download timed out', secureUrl.href));
    });
    outgoing.on('error', reject);
  });
}

async function downloadFile(url: string, destination: string, maxBytes: number): Promise<void> {
  const response = await openReleaseUrl(assertSecureReleaseUrl(url), MAX_REDIRECTS, maxBytes);
  try {
    await pipeline(
      response,
      createDownloadLimiter(maxBytes),
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}

async function sha256(path: string): Promise<Buffer> {
  const contents = await readFile(path);
  return createHash('sha256').update(contents).digest();
}

async function downloadVerifiedRelease(version: string, temporaryDirectory: string): Promise<string> {
  const asset = `gopeak-${version}.tgz`;
  const releaseBase = `https://github.com/${REPOSITORY}/releases/download/v${version}`;
  const archivePath = join(temporaryDirectory, asset);
  const checksumPath = `${archivePath}.sha256`;
  await downloadFile(`${releaseBase}/${asset}`, archivePath, MAX_ARCHIVE_BYTES);
  await downloadFile(`${releaseBase}/${asset}.sha256`, checksumPath, MAX_CHECKSUM_BYTES);

  const checksumText = await readFile(checksumPath, 'utf8');
  const expectedText = checksumText.trim().split(/\s+/)[0] ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(expectedText)) {
    throw new ReleaseDownloadError('release checksum file is malformed', `${releaseBase}/${asset}.sha256`);
  }
  const expected = Buffer.from(expectedText, 'hex');
  const actual = await sha256(archivePath);
  if (!timingSafeEqual(actual, expected)) {
    throw new ReleaseDownloadError('release checksum verification failed; existing installation was not changed', archivePath);
  }
  return archivePath;
}

export async function replaceGlobalPackage(
  replacement: GlobalReplacement,
  runner: CommandRunner = runCommand,
): Promise<void> {
  const removal = await runner('bun', ['remove', '-g', 'gopeak']);
  if (removal.code !== 0) {
    throw new ReleaseDownloadError(removal.stderr || 'Bun could not remove the existing release', replacement.nextArchive);
  }
  const installation = await runner('bun', ['add', '-g', replacement.nextArchive]);
  if (installation.code === 0) return;
  if (!replacement.rollbackArchive) {
    throw new ReleaseDownloadError(installation.stderr || 'Bun could not install the verified release', replacement.nextArchive);
  }
  const rollback = await runner('bun', ['add', '-g', replacement.rollbackArchive]);
  if (rollback.code === 0) {
    throw new ReleaseDownloadError(
      `${installation.stderr || 'Bun could not install the verified release'}; the previous release was restored`,
      replacement.nextArchive,
    );
  }
  throw new ReleaseDownloadError(
    `${installation.stderr || 'Bun could not install the verified release'}; rollback also failed: ${rollback.stderr}`,
    replacement.nextArchive,
  );
}

async function getInstalledVersion(runner: CommandRunner): Promise<string | null> {
  const globalPackages = await runner('bun', ['pm', 'ls', '-g']);
  if (globalPackages.code !== 0 || !/(?:^|\s)gopeak@/m.test(globalPackages.stdout)) return null;
  const current = await runner('gopeak', ['version']);
  const currentVersionText = /\bv?([^\s]+)$/.exec(current.stdout)?.[1] ?? '';
  const currentVersion = parseSemver(currentVersionText);
  if (current.code !== 0 || !currentVersion) {
    throw new ReleaseDownloadError('existing GoPeak version could not be resolved; installation was not changed', 'global installation');
  }
  return currentVersion.normalized;
}

export async function installRelease(version: string, runner: CommandRunner = runCommand): Promise<void> {
  const parsedVersion = parseSemver(version);
  if (!parsedVersion || parsedVersion.normalized !== version) {
    throw new ReleaseDownloadError('release version is malformed', version);
  }
  const installedVersion = await getInstalledVersion(runner);
  if (installedVersion === version) return;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'gopeak-update-'));
  try {
    const archivePath = await downloadVerifiedRelease(version, temporaryDirectory);
    if (!installedVersion) {
      const installation = await runner('bun', ['add', '-g', archivePath]);
      if (installation.code !== 0) {
        throw new ReleaseDownloadError(installation.stderr || 'Bun could not install the verified release', archivePath);
      }
      return;
    }
    const rollbackArchive = await downloadVerifiedRelease(installedVersion, temporaryDirectory);
    await replaceGlobalPackage({ nextArchive: archivePath, rollbackArchive }, runner);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function updateGoPeak(): Promise<void> {
  const version = await fetchLatestVersion();
  if (!version) {
    throw new ReleaseDownloadError('could not resolve the latest GitHub Release', 'GitHub Releases API');
  }
  console.log(`Downloading and verifying GoPeak v${version}...`);
  await installRelease(version);
  console.log(`✅ GoPeak v${version} installed successfully.`);
}
