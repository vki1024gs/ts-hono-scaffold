import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPnpmSync } from './lib/pnpm.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pending = () =>
  execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: root, encoding: 'utf8' },
  ).trim();

const requireClean = (stage) => {
  const output = pending();
  if (!output) return;
  throw new Error(
    `PUSH_CHECK_DIRTY: Git worktree is not clean ${stage}. Commit or remove the following changes before pushing:\n${output}`,
  );
};

try {
  requireClean('before verification');
  runPnpmSync(['verify'], { cwd: root, stdio: 'inherit' });
  runPnpmSync(['verify:generated'], { cwd: root, stdio: 'inherit' });
  requireClean('after verification');
  console.log(
    'Push verification passed: clean Git state, aligned version, repository privacy policy, full checks and fresh generated-project lifecycle.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
