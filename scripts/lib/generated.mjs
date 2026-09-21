import { cpSync, mkdtempSync, rmSync } from 'node:fs';
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
export function finalizeVerificationCopy({
  temporary,
  project,
  completed,
  stage,
  label = 'Generated verification',
  environment = process.env,
  report = console.error,
}) {
  const retain = !completed && environment.SCAFFOLD_KEEP_FAILED_VERIFY === '1';
  if (retain) {
    report(
      `${label} failed during "${stage}". Inspection copy retained: ${project}`,
    );
    return { cleaned: false, retained: true };
  }
  try {
    rmSync(temporary, { recursive: true, force: true });
    if (!completed)
      report(
        `${label} failed during "${stage}". Temporary copy removed. ` +
          'Set SCAFFOLD_KEEP_FAILED_VERIFY=1 to retain a future failure for inspection.',
      );
    return { cleaned: true, retained: false };
  } catch {
    report(`${label} could not clean its temporary copy: ${project}`);
    return { cleaned: false, retained: false };
  }
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
