import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
export function copyProject(root, label = 'generated') {
  const temporary = mkdtempSync(path.join(tmpdir(), 'scaffold-' + label + '-')),
    project = path.join(temporary, 'project');
  cpSync(root, project, {
    recursive: true,
    filter: (source) =>
      ![
        '.git',
        'node_modules',
        '.runtime',
        '.env',
        'dist',
        'coverage',
        'data',
        '.DS_Store',
      ].includes(path.basename(source)) && !source.endsWith('.tsbuildinfo'),
  });
  execFileSync('git', ['init', '-b', 'main'], {
    cwd: project,
    stdio: 'ignore',
  });
  return { temporary, project };
}
export async function freePorts() {
  const servers = [net.createServer(), net.createServer()];
  try {
    await Promise.all(
      servers.map(
        (s) =>
          new Promise((resolve, reject) => {
            s.once('error', reject);
            s.listen(0, '127.0.0.1', resolve);
          }),
      ),
    );
    return servers.map((s) => s.address().port);
  } finally {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  }
}
