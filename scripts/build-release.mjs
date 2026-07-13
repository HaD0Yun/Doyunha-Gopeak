#!/usr/bin/env bun

import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(root, 'src');
const buildRoot = path.join(root, 'build');

async function buildBundledEntrypoint(sourceName, outputName) {
  const result = await Bun.build({
    entrypoints: [path.join(sourceRoot, sourceName)],
    outdir: buildRoot,
    naming: outputName,
    // Bun supplies `ws` as a runtime compatibility module. Keeping Bun as the
    // target preserves its working WebSocket server implementation on 1.3.3;
    // embedding the npm `ws` package with `target: node` stalls WS upgrades.
    target: 'bun',
    format: 'esm',
    bundle: true,
    packages: 'bundle',
    minify: false,
    sourcemap: 'none',
  });

  if (result.success) return;

  for (const log of result.logs) {
    console.error(log);
  }
  throw new Error(`Bundling ${sourceName} failed`);
}

async function collectTypeScriptEntries(directory) {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const itemPath = path.join(directory, item.name);
    if (item.isDirectory()) {
      entries.push(...await collectTypeScriptEntries(itemPath));
    } else if (item.isFile() && item.name.endsWith('.ts')) {
      entries.push(itemPath);
    }
  }
  return entries;
}

await rm(buildRoot, { recursive: true, force: true });
await mkdir(buildRoot, { recursive: true });

await buildBundledEntrypoint('cli.ts', 'cli.js');
await buildBundledEntrypoint('server-entry.ts', 'index.js');

for (const sourcePath of await collectTypeScriptEntries(sourceRoot)) {
  const relativePath = path.relative(sourceRoot, sourcePath);
  if (relativePath === 'cli.ts' || relativePath === 'index.ts' || relativePath === 'server-entry.ts') continue;

  const outputPath = path.join(buildRoot, relativePath.replace(/\.ts$/, '.js'));
  await mkdir(path.dirname(outputPath), { recursive: true });
  const result = Bun.spawnSync([
    process.execPath,
    'build',
    sourcePath,
    `--outfile=${outputPath}`,
    '--target=bun',
    '--format=esm',
    '--sourcemap=none',
    '--no-bundle',
  ], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`Development module build failed for ${relativePath}:\n${result.stderr.toString().trim()}`);
  }
}

const visualizerBuild = await Bun.build({
  entrypoints: [path.join(sourceRoot, 'visualizer', 'main.js')],
  target: 'browser',
  format: 'iife',
  bundle: true,
  minify: false,
  write: false,
});
if (!visualizerBuild.success) {
  for (const log of visualizerBuild.logs) {
    console.error(log);
  }
  throw new Error('Visualizer build failed');
}

const [template, css, bundledJavaScript] = await Promise.all([
  readFile(path.join(sourceRoot, 'visualizer', 'template.html'), 'utf8'),
  readFile(path.join(sourceRoot, 'visualizer', 'visualizer.css'), 'utf8'),
  visualizerBuild.outputs[0].text(),
]);
await writeFile(
  path.join(buildRoot, 'visualizer.html'),
  template.replace('%%CSS%%', css).replace('%%SCRIPT%%', bundledJavaScript),
  'utf8',
);

await mkdir(path.join(buildRoot, 'scripts'), { recursive: true });
await cp(
  path.join(sourceRoot, 'scripts', 'godot_operations.gd'),
  path.join(buildRoot, 'scripts', 'godot_operations.gd'),
);
await cp(path.join(sourceRoot, 'addon'), path.join(buildRoot, 'addon'), { recursive: true });
await writeFile(
  path.join(buildRoot, 'godot-mcp.js'),
  '#!/usr/bin/env bun\nimport \'./cli.js\';\n',
  'utf8',
);

for (const executable of ['cli.js', 'godot-mcp.js', 'index.js']) {
  const executablePath = path.join(buildRoot, executable);
  const contents = await readFile(executablePath, 'utf8');
  if (!contents.startsWith('#!/usr/bin/env bun\n')) {
    await writeFile(executablePath, `#!/usr/bin/env bun\n${contents}`, 'utf8');
  }
  await chmod(executablePath, 0o755);
}

console.log(`Built dependency-free GoPeak runtime bundles with Bun ${Bun.version}`);
