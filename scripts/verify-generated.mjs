import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPnpmSync } from './lib/pnpm.mjs';
import {
  copyProject,
  finalizeVerificationCopy,
  freePorts,
} from './lib/generated.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { temporary, project } = copyProject(root),
  [apiPort, webPort] = await freePorts();
let completed = false,
  started = false,
  stage = 'initialize project',
  failure;
const run = (args) =>
  execFileSync(process.execPath, args, {
    cwd: project,
    stdio: 'inherit',
    timeout: 120000,
  });
try {
  run([
    'scripts/init.mjs',
    '--name',
    'generated-check',
    '--scope',
    '@generated-check',
    '--backend-port',
    String(apiPort),
    '--frontend-port',
    String(webPort),
    '--allow-occupied-ports',
  ]);
  appendFileSync(path.join(project, '.env'), '\nAPP_DATA_DIR=.runtime\n');
  const containsFiles = (directory) =>
    existsSync(directory) &&
    readdirSync(directory, { withFileTypes: true }).some(
      (entry) =>
        entry.isFile() || containsFiles(path.join(directory, entry.name)),
    );
  if (containsFiles(path.join(project, '.scaffold/recipes')))
    throw new Error('Optional recipe source was not relocated');
  for (const relative of [
    'docs/scaffold/README.md',
    'docs/scaffold/frontend.md',
    'docs/scaffold/recipes/README.md',
    'docs/scaffold/recipes/ui/ItemsPage.tsx',
  ])
    if (!existsSync(path.join(project, relative)))
      throw new Error(`Generated reference missing: ${relative}`);
  if (
    !readFileSync(path.join(project, 'PROJECT_STATUS.md'), 'utf8').includes(
      'pending',
    )
  )
    throw new Error('Generated verification state is not pending');
  execFileSync('git', ['add', '.'], { cwd: project, stdio: 'ignore' });
  stage = 'install locked dependencies';
  runPnpmSync(['install', '--frozen-lockfile'], {
    cwd: project,
    stdio: 'inherit',
  });
  stage = 'verify generated source and production artifact';
  runPnpmSync(['verify'], { cwd: project, stdio: 'inherit' });
  stage = 'start managed runtime';
  const begin = performance.now();
  run(['scripts/app.mjs', 'start']);
  started = true;
  console.log(
    'Generated managed cold start (including build): ' +
      Math.round(performance.now() - begin) +
      ' ms',
  );
  stage = 'verify managed runtime';
  run(['scripts/smoke.mjs']);
  run(['scripts/app.mjs', 'status', '--json']);
  run(['scripts/app.mjs', 'logs', '--lines', '3', '--json']);
  run(['scripts/verify-runtime.mjs']);
  started = false;
  stage = 'verify foreground runtime';
  run(['scripts/verify-foreground.mjs']);
  completed = true;
  console.log(
    'Fresh generated project passed frozen install, verify, managed start, smoke and stop.',
  );
} catch (error) {
  failure = error;
} finally {
  if (started)
    try {
      run(['scripts/app.mjs', 'stop']);
    } catch {}
  const cleanup = finalizeVerificationCopy({
    temporary,
    project,
    completed,
    stage,
  });
  if (completed && !cleanup.cleaned)
    failure = new Error('GENERATED_VERIFICATION_TEMP_CLEANUP_FAILED');
}
if (failure) throw failure;
