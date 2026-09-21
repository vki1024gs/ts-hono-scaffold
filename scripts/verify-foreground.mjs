import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectConfig } from './lib/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = projectConfig(root);
const child = spawn(process.execPath, ['scripts/run-app.mjs'], {
  cwd: root,
  env: config.env,
  stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
  windowsHide: true,
});
let output = '';
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error('FOREGROUND_TIMEOUT')),
    20000,
  );
  child.stdout.on('data', (chunk) => {
    output += chunk;
    for (const line of output.split(/\r?\n/)) {
      try {
        if (JSON.parse(line).type === 'service.ready') {
          clearTimeout(timer);
          resolve();
        }
      } catch {}
    }
  });
  child.once('exit', (code) => reject(new Error(`FOREGROUND_EXITED_${code}`)));
});
try {
  await ready;
  const response = await fetch(config.apiOrigin + '/health/ready');
  if (!response.ok) throw new Error('FOREGROUND_NOT_READY');
  if (process.platform === 'win32') child.send('shutdown');
  else child.kill('SIGTERM');
  const code = await new Promise((resolve) => child.once('exit', resolve));
  if (code !== 0) throw new Error(`FOREGROUND_STOP_FAILED_${code}`);
  console.log(
    'Foreground owner start, readiness and graceful shutdown passed.',
  );
} catch (error) {
  if (process.platform === 'win32' && child.connected) child.send('shutdown');
  else child.kill('SIGTERM');
  throw error;
}
