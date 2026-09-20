import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateServiceManifest } from './lib/service-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let tracked;
let candidates;
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  candidates = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .filter(Boolean);
} catch {
  console.error('Repository verification requires a Git worktree.');
  process.exit(1);
}

const required = [
  '.env.example',
  '.github/workflows/ci.yml',
  '.node-version',
  'AGENTS.md',
  'PROJECT_STATUS.md',
  'README.md',
  'package.json',
  'service.manifest.json',
  'pnpm-lock.yaml',
  'scripts/app.mjs',
  'scripts/build.mjs',
  'scripts/doctor.mjs',
  'scripts/init.mjs',
  'scripts/smoke.mjs',
  'scripts/verify-repository.mjs',
  'scripts/verify-generated.mjs',
  'scripts/verify-push.mjs',
  'scripts/verify-version.mjs',
];
const retiredDocuments = [
  'docs/PRD-scaffold-evolution.md',
  'docs/PRD-managed-service-contract.md',
];
const forbidden = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)data\//,
  /^\.runtime\//,
  /(^|\/)coverage\//,
  /\.db(?:-shm|-wal)?$/,
  /\.log$/,
  /(^|\/)(?:id_rsa|id_ed25519)$/,
  /\.(?:key|pem|p12|pfx)$/i,
  /\.tsbuildinfo$/,
  /(^|\/)\.DS_Store$/,
];
const unsafeSecretPattern = new RegExp(
  [
    'SESSION_SECRET=',
    'change-',
    'me|BEGIN ',
    '(?:RSA |EC |OPENSSH )?',
    'PRIVATE KEY',
  ].join(''),
);
const missing = required.filter((file) => !existsSync(path.join(root, file)));
const retiredPresent = retiredDocuments.filter((file) =>
  existsSync(path.join(root, file)),
);
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const serviceManifest = JSON.parse(
  readFileSync(path.join(root, 'service.manifest.json'), 'utf8'),
);
const manifestErrors = validateServiceManifest(serviceManifest, packageJson);
const forbiddenTracked = candidates.filter((file) => {
  if (file === '.env' || (file.startsWith('.env.') && file !== '.env.example'))
    return true;
  return forbidden.some((pattern) => pattern.test(file));
});
const unsafeText = [];
for (const file of candidates) {
  const absolute = path.join(root, file);
  if (!existsSync(absolute)) continue;
  let content;
  try {
    content = readFileSync(absolute, 'utf8');
  } catch {
    continue;
  }
  if (
    /\/(?:Users|home)\/[A-Za-z0-9._-]+\//.test(content) ||
    /[A-Za-z]:\\Users\\[^\\]+\\/.test(content)
  ) {
    unsafeText.push(`${file}: contains an absolute user path`);
  }
  if (unsafeSecretPattern.test(content)) {
    unsafeText.push(
      `${file}: contains a secret placeholder or private key marker`,
    );
  }
}

if (
  missing.length ||
  retiredPresent.length ||
  forbiddenTracked.length ||
  unsafeText.length ||
  manifestErrors.length
) {
  if (missing.length)
    console.error(`Missing required tracked files:\n${missing.join('\n')}`);
  if (retiredPresent.length)
    console.error(`Retired planning documents:\n${retiredPresent.join('\n')}`);
  if (forbiddenTracked.length)
    console.error(`Forbidden tracked files:\n${forbiddenTracked.join('\n')}`);
  if (unsafeText.length)
    console.error(`Unsafe repository content:\n${unsafeText.join('\n')}`);
  if (manifestErrors.length)
    console.error(`Invalid service manifest:\n${manifestErrors.join('\n')}`);
  process.exit(1);
}
console.log(
  `Repository policy verified (${tracked.length} tracked, ${candidates.length - tracked.length} pending files).`,
);
