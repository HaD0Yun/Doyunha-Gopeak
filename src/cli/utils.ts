import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LATEST_RELEASE_URL = 'https://api.github.com/repos/HaD0Yun/Doyunha-Gopeak/releases/latest';
const MAX_RELEASE_RESPONSE_BYTES = 1_048_576;
const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const GOPEAK_DIR = join(homedir(), '.gopeak');
const LAST_CHECK_FILE = join(GOPEAK_DIR, 'last-check');
const NOTIFY_FILE = join(GOPEAK_DIR, 'notify');
const ONBOARDING_SHOWN_FILE = join(GOPEAK_DIR, 'onboarding-shown');
const STAR_PROMPTED_FILE = join(GOPEAK_DIR, 'star-prompted');

export { GOPEAK_DIR, LAST_CHECK_FILE, NOTIFY_FILE, ONBOARDING_SHOWN_FILE, STAR_PROMPTED_FILE };

type LatestVersionOptions = {
  readonly url?: string;
  readonly timeoutMs?: number;
};

type ParsedSemver = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
  readonly normalized: string;
};

export type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
};

export function ensureGopeakDir(): void {
  if (!existsSync(GOPEAK_DIR)) mkdirSync(GOPEAK_DIR, { recursive: true });
}

export function getLocalVersion(): string {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const packageCandidates = [
    join(currentDirectory, '..', 'package.json'),
    join(currentDirectory, '..', '..', 'package.json'),
  ] as const;
  for (const packagePath of packageCandidates) {
    try {
      const value: unknown = JSON.parse(readFileSync(packagePath, 'utf-8'));
      if (
        typeof value === 'object'
        && value !== null
        && 'name' in value
        && value.name === 'gopeak'
        && 'version' in value
        && typeof value.version === 'string'
      ) {
        return value.version;
      }
    } catch {
      continue;
    }
  }
  return '0.0.0';
}

export function parseSemver(value: string): ParsedSemver | null {
  const match = VERSION_PATTERN.exec(value);
  if (!match) return null;
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (major === undefined || minor === undefined || patch === undefined) return null;
  const prereleaseText = match[4];
  const normalizedCore = `${major}.${minor}.${patch}`;
  const normalizedPrerelease = prereleaseText ? `-${prereleaseText}` : '';
  const build = match[5] ? `+${match[5]}` : '';
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prereleaseText ? prereleaseText.split('.') : [],
    normalized: `${normalizedCore}${normalizedPrerelease}${build}`,
  };
}

export function fetchLatestVersion(options: LatestVersionOptions = {}): Promise<string | null> {
  const url = new URL(options.url ?? LATEST_RELEASE_URL);
  const timeoutMs = options.timeoutMs ?? 5_000;
  const request = url.protocol === 'http:' ? httpGet : httpsGet;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const outgoing = request(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'gopeak-update-check',
      },
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        finish(null);
        return;
      }

      let data = '';
      let receivedBytes = 0;
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        receivedBytes += Buffer.byteLength(chunk);
        if (receivedBytes > MAX_RELEASE_RESPONSE_BYTES) {
          response.destroy();
          finish(null);
          return;
        }
        data += chunk;
      });
      response.on('end', () => {
        try {
          const value: unknown = JSON.parse(data);
          if (typeof value !== 'object' || value === null || !('tag_name' in value) || typeof value.tag_name !== 'string') {
            finish(null);
            return;
          }
          finish(parseSemver(value.tag_name)?.normalized ?? null);
        } catch {
          finish(null);
        }
      });
      response.on('error', () => finish(null));
    });

    outgoing.setTimeout(timeoutMs, () => {
      outgoing.destroy();
      finish(null);
    });
    outgoing.on('error', () => finish(null));
  });
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return 0;
  for (const [leftPart, rightPart] of [
    [left.major, right.major],
    [left.minor, right.minor],
    [left.patch, right.patch],
  ] as const) {
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const identifierCount = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftIsNumeric = /^\d+$/.test(leftIdentifier);
    const rightIsNumeric = /^\d+$/.test(rightIdentifier);
    if (leftIsNumeric && rightIsNumeric) {
      return Number(leftIdentifier) > Number(rightIdentifier) ? 1 : -1;
    }
    if (leftIsNumeric) return -1;
    if (rightIsNumeric) return 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }
  return 0;
}

export function isCacheFresh(maxAgeSeconds = 86_400): boolean {
  try {
    if (!existsSync(LAST_CHECK_FILE)) return false;
    const timestamp = Number.parseInt(readFileSync(LAST_CHECK_FILE, 'utf-8').trim(), 10);
    return Date.now() / 1_000 - timestamp < maxAgeSeconds;
  } catch {
    return false;
  }
}

export function updateCacheTimestamp(): void {
  ensureGopeakDir();
  writeFileSync(LAST_CHECK_FILE, String(Math.floor(Date.now() / 1_000)));
}

export function writeNotifyFile(message: string): void {
  ensureGopeakDir();
  writeFileSync(NOTIFY_FILE, message);
}

export function clearNotifyFile(): void {
  rmSync(NOTIFY_FILE, { force: true });
}

export function getShellRcFile(): string {
  const homeDirectory = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return join(homeDirectory, (process.env.SHELL ?? '').includes('zsh') ? '.zshrc' : '.bashrc');
}

export function getShellName(): string {
  return (process.env.SHELL ?? '').includes('zsh') ? 'zsh' : 'bash';
}

export function supportsShellHooks(platform = process.platform, shell = process.env.SHELL ?? ''): boolean {
  return platform !== 'win32' && (shell.includes('bash') || shell.includes('zsh'));
}

export async function commandExists(command: string): Promise<boolean> {
  return (await runCommand('which', [command])).code === 0;
}

export function runCommand(command: string, args: readonly string[] = []): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => resolve({ stdout: '', stderr: error.message, code: 1 }));
    child.on('close', (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 }));
  });
}
