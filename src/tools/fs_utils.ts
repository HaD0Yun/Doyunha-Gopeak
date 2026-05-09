import { readdirSync, statSync } from 'node:fs';
import { join, relative as relativePath } from 'node:path';

export function collectFiles(
  projectPath: string,
  dir: string,
  extensions: string[],
  filter?: (relPath: string) => boolean
): string[] {
  const results: string[] = [];

  function scan(d: string): void {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }

    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const fullPath = join(d, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        if (name === 'addons' || name === '.godot' || name === '.gopeak') continue;
        scan(fullPath);
      } else if (extensions.some(ext => name.endsWith('.' + ext))) {
        const relPath = 'res://' + relativePath(projectPath, fullPath).replace(/\\/g, '/');
        if (!filter || filter(relPath)) {
          results.push(fullPath);
        }
      }
    }
  }

  scan(dir);
  return results;
}
