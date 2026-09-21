#!/usr/bin/env node
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const root = process.cwd();
const markerFile = path.join(root, '.scaffold', 'project.json');
const allowedRootFiles = [
  '.gitattributes',
  '.env.example',
  '.prettierignore',
  '.prettierrc.json',
  'AGENTS.md',
  'Makefile',
  'eslint.config.mjs',
  'README.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'service.manifest.json',
];
const allowedDirectories = ['.scaffold', 'packages', 'scripts'];
const allowedExtensions = new Set([
  '.css',
  '.html',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'data',
  '.runtime',
]);

function readArg(name) {
  const flag = `--${name}`;
  const direct = process.argv.indexOf(flag);
  if (direct >= 0) return process.argv[direct + 1] ?? '';
  const prefix = `${flag}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}
const hasFlag = (name) => process.argv.includes(`--${name}`);
const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'my-project';
const normalizeScope = (value) => {
  const raw = value.trim() || '@proj';
  return raw.startsWith('@') ? raw : `@${raw}`;
};
const validScope = (value) => /^@[a-z0-9][a-z0-9-]*$/.test(value);
const validPort = (value) =>
  Number.isInteger(Number(value)) &&
  Number(value) >= 1 &&
  Number(value) <= 65535;

const generatedAgentRules = ({
  name,
  packageScope,
  backendPort,
  frontendPort,
}) => `# Application agent rules

## Mission

This is the initialized ${name} application, derived from the TypeScript/Hono scaffold. Treat this repository as an application, not as a scaffold maintainer checkout. Project identity and original scaffold lineage are recorded in \`.scaffold/project.json\`.

## Cold start

- Requires Node.js 24+ and pnpm 10.20.0.
- Do not run first-time initialization again. Use \`node scripts/init.mjs --reconfigure\` only to change supported ports or description without renaming the project.
- \`.scaffold/SCAFFOLD_MAINTAINER.md\` is inactive historical reference from the template and is not an instruction file for this application.
- Install with \`corepack pnpm install --frozen-lockfile\`, then run \`pnpm verify\` before relying on the checkout.
- Use \`pnpm dev\` for foreground development, \`pnpm app:start\` for the owned local background instance, and \`pnpm app:run\` when an external process manager owns the foreground process.
- Diagnose with \`pnpm doctor\`, \`pnpm app:status\`, \`pnpm smoke\`, and \`pnpm app:logs\`.

## Project identity

- Package scope: \`${packageScope}\`.
- Default API: \`http://127.0.0.1:${backendPort}\`.
- Default WebUI: \`http://127.0.0.1:${frontendPort}\`.
- Process environment overrides \`.env\`; \`APP_DATA_DIR\` owns machine-local settings, backups, logs, locks and runtime state.

## Architecture and change rules

- Change public API schemas in \`packages/api\` first, then update \`packages/webui\`, the centralized client in \`packages/frontend/src/api\`, UI code and tests together.
- Keep domain logic and durable settings codecs in \`packages/core\`; keep filesystem adapters in \`packages/db\`; extend the existing \`createApp(options)\` composition boundary rather than adding a service locator or plugin loader.
- Frontend components do not call \`fetch\` directly.
- Never kill a process because it owns a configured port. Managed lifecycle commands may stop only the recorded project-owned process tree.
- Use one lifecycle owner. Do not run \`app:start\` inside Docker or another service manager that already owns \`app:run\`.
- Keep development dependencies out of runtime. \`pnpm build\` must emit the bundled API, static WebUI and build identity; \`app:run\` must not resolve TypeScript, tsx, Vite, Vitest, ESLint or Prettier.
- Keep startup configuration in environment variables. Durable user documents require stable identity, schema versions, sequential migrations, validation, backup and rollback; upgrades must not overwrite \`APP_DATA_DIR\`.
- Never commit \`.env\`, credentials, dependencies, build output, logs, databases or machine-local application data.

## Required checks

Run \`pnpm verify\` before handoff. For lifecycle or deployment changes, also run \`pnpm verify:production\` and \`pnpm verify:generated\`. Record only verification actually performed for this application; scaffold maintainer results are not application evidence.
`;

async function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory())
        return ignoredDirectories.has(entry.name) ? [] : collectFiles(full);
      if (!entry.isFile() || !allowedExtensions.has(path.extname(entry.name)))
        return [];
      return [full];
    }),
  );
  return nested.flat();
}

async function portAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(Number(port), '127.0.0.1', () =>
      server.close(() => resolve(true)),
    );
  });
}

export async function atomicWrite(changes, io = fs) {
  const prepared = [];
  const originals = new Map();
  try {
    for (const [file, content] of changes) {
      await io.mkdir(path.dirname(file), { recursive: true });
      originals.set(file, existsSync(file) ? await io.readFile(file) : null);
      if (content === null) continue;
      const temporary = `${file}.scaffold-${process.pid}-${prepared.length}.tmp`;
      await io.writeFile(temporary, content);
      prepared.push([file, temporary]);
    }
    for (const [file, temporary] of prepared) await io.rename(temporary, file);
    for (const [file, content] of changes)
      if (content === null) await io.rm(file, { force: true });
  } catch (error) {
    for (const [, temporary] of prepared)
      await io.rm(temporary, { force: true }).catch(() => {});
    for (const [file, original] of originals) {
      if (original === null) await io.rm(file, { force: true }).catch(() => {});
      else await io.writeFile(file, original).catch(() => {});
    }
    throw error;
  }
}

async function main() {
  if (hasFlag('help')) {
    console.log(
      'Usage: node scripts/init.mjs [--name NAME] [--scope @SCOPE] [--backend-port PORT] [--frontend-port PORT] [--description TEXT] [--dry-run] [--reconfigure] [--allow-occupied-ports]',
    );
    return;
  }
  const current = existsSync(markerFile)
    ? JSON.parse(await fs.readFile(markerFile, 'utf8'))
    : null;
  if (current && !hasFlag('reconfigure'))
    throw new Error(
      'This project is already initialized. Use --reconfigure to change supported settings.',
    );
  const interactive = process.stdin.isTTY && !hasFlag('non-interactive');
  const rl = interactive ? readline.createInterface({ input, output }) : null;
  const value = async (arg, prompt, fallback) => {
    const supplied = readArg(arg);
    if (supplied !== undefined) return supplied;
    if (!rl) return fallback;
    return (await rl.question(`${prompt} [${fallback}]: `)) || fallback;
  };
  try {
    const name = slugify(
      await value('name', 'Project name', current?.name || 'my-project'),
    );
    const packageScope = normalizeScope(
      await value(
        'scope',
        'Package scope',
        current?.packageScope || `@${name}`,
      ),
    );
    const backendPort = String(
      await value(
        'backend-port',
        'Backend port',
        current?.backendPort || '18080',
      ),
    ).trim();
    const frontendPort = String(
      await value(
        'frontend-port',
        'Frontend port',
        current?.frontendPort || '2711',
      ),
    ).trim();
    const description = String(
      await value(
        'description',
        'Description',
        current?.description || `${name} application`,
      ),
    ).trim();

    if (!validScope(packageScope))
      throw new Error(
        'Package scope must look like @my-scope and contain lowercase letters, digits, or hyphens.',
      );
    if (!validPort(backendPort) || !validPort(frontendPort))
      throw new Error('Ports must be integers between 1 and 65535.');
    if (backendPort === frontendPort)
      throw new Error('Backend and frontend ports must be different.');
    if (
      current &&
      (name !== current.name || packageScope !== current.packageScope)
    ) {
      throw new Error(
        '--reconfigure cannot rename the project or package scope. Create a new project for an identity change.',
      );
    }
    if (!hasFlag('allow-occupied-ports')) {
      for (const [label, port] of [
        ['backend', backendPort],
        ['frontend', frontendPort],
      ]) {
        if (!(await portAvailable(port)))
          throw new Error(
            `${label} port ${port} is in use. Choose another port or pass --allow-occupied-ports after confirming ownership.`,
          );
      }
    }

    const files = [
      ...allowedRootFiles.map((relative) => path.join(root, relative)),
      ...(
        await Promise.all(
          allowedDirectories.map((relative) =>
            collectFiles(path.join(root, relative)),
          ),
        )
      ).flat(),
    ];
    const missing = allowedRootFiles.filter(
      (relative) => !existsSync(path.join(root, relative)),
    );
    if (missing.length)
      throw new Error(`Template is incomplete; missing: ${missing.join(', ')}`);
    const old = current || {
      name: 'my-project',
      packageScope: '@proj',
      backendPort: '18080',
      frontendPort: '2711',
    };
    const replacements = [
      [`${old.packageScope} Frontend`, name],
      [`${old.packageScope} CLI`, `${name} CLI`],
      [old.packageScope, packageScope],
      [old.name, name],
    ].filter(([from, to]) => from !== to);
    const changes = new Map();
    for (const file of new Set(files)) {
      if (!existsSync(file)) continue;
      let content = await fs.readFile(file, 'utf8');
      for (const [from, to] of replacements)
        content = content.split(from).join(to);
      if (String(old.backendPort) !== backendPort) {
        content = content.replace(
          new RegExp(`\\b${old.backendPort}\\b`, 'g'),
          backendPort,
        );
      }
      if (String(old.frontendPort) !== frontendPort) {
        content = content.replace(
          new RegExp(`\\b${old.frontendPort}\\b`, 'g'),
          frontendPort,
        );
      }
      if (file === path.join(root, 'package.json')) {
        const manifest = JSON.parse(content);
        manifest.name = `${packageScope}/workspace`;
        manifest.description = description;
        content = `${JSON.stringify(manifest, null, 2)}\n`;
      }
      changes.set(file, content);
    }
    const example = changes.get(path.join(root, '.env.example'));
    const envPath = path.join(root, '.env');
    if (!existsSync(envPath)) changes.set(envPath, example);
    else if (current) {
      let local = await fs.readFile(envPath, 'utf8');
      for (const [key, value] of [
        ['PORT', backendPort],
        ['VITE_PORT', frontendPort],
      ]) {
        const pattern = new RegExp('^' + key + '=.*$', 'm');
        local = pattern.test(local)
          ? local.replace(pattern, key + '=' + value)
          : local + '\n' + key + '=' + value + '\n';
      }
      changes.set(envPath, local);
    }
    const rootPackage = JSON.parse(
      changes.get(path.join(root, 'package.json')),
    );
    changes.set(
      markerFile,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          documentType: 'scaffold-project',
          scaffoldVersion: current?.scaffoldVersion || rootPackage.version,
          name,
          packageScope,
          description,
          backendPort,
          frontendPort,
          initializedAt: current?.initializedAt || new Date().toISOString(),
          reconfiguredAt: current ? new Date().toISOString() : undefined,
        },
        null,
        2,
      )}\n`,
    );

    if (!current) {
      const archivedRulesFile = path.join(
        root,
        '.scaffold',
        'SCAFFOLD_MAINTAINER.md',
      );
      if (!existsSync(archivedRulesFile)) {
        const maintainerRules = await fs.readFile(
          path.join(root, 'AGENTS.md'),
          'utf8',
        );
        changes.set(
          archivedRulesFile,
          '# Scaffold maintainer rules (inactive reference)\n\n' +
            'This file was the template root AGENTS.md before initialization. It is retained only for provenance and must not override the initialized application rules at the repository root.\n\n' +
            maintainerRules,
        );
      }
      changes.set(
        path.join(root, 'AGENTS.md'),
        generatedAgentRules({
          name,
          packageScope,
          backendPort,
          frontendPort,
        }),
      );
      changes.set(
        path.join(root, 'PROJECT_STATUS.md'),
        '# Project status\n\nApplication version: ' +
          rootPackage.version +
          '\nScaffold source: ' +
          rootPackage.version +
          '\n\nAll verification states: pending. Run frozen install, pnpm verify, managed start and smoke locally. Template maintainer results are not project evidence.\n',
      );
      for (const file of await collectFiles(
        path.join(root, '.scaffold/recipes'),
      ))
        changes.set(file, null);
      for (const relative of [
        'docs/PRD-scaffold-evolution.md',
        'docs/PRD-managed-service-contract.md',
        'scripts/verify-recipes.mjs',
      ])
        if (existsSync(path.join(root, relative)))
          changes.set(path.join(root, relative), null);
    }
    console.log(
      `${current ? 'Reconfigure' : 'Initialize'} ${name} (${packageScope})`,
    );
    console.log(
      `API http://127.0.0.1:${backendPort}; WebUI http://127.0.0.1:${frontendPort}`,
    );
    console.log(`${changes.size} files will be written.`);
    if (hasFlag('dry-run')) {
      console.log('Dry run complete; no files were changed.');
      return;
    }
    await atomicWrite(changes);
    console.log(
      'Initialization completed. Run corepack pnpm install --frozen-lockfile, then pnpm verify.',
    );
  } finally {
    rl?.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
