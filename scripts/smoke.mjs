import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose, validateState } from './lib/diagnostics.mjs';
import { projectConfig } from './lib/config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = projectConfig(root);
try {
  const state = validateState(
    JSON.parse(await readFile(config.stateFile, 'utf8')),
    root,
  );
  const result = await diagnose(root, state);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.exitCode;
} catch (error) {
  const exitCode = error.code === 'ENOENT' ? 1 : 3;
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      status: exitCode === 1 ? 'stopped' : 'error',
      exitCode,
      code: exitCode === 1 ? 'NOT_RUNNING' : 'STATE_INVALID',
      message:
        exitCode === 1
          ? 'Application is stopped.'
          : 'Inspect managed state and configuration.',
    }),
  );
  process.exitCode = exitCode;
}
