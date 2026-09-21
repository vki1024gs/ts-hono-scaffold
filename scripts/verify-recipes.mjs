import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { copyProject, finalizeVerificationCopy } from './lib/generated.mjs';
import { runPnpmSync } from './lib/pnpm.mjs';
import { projectConfig } from './lib/config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = projectConfig(root);
const selected = process.argv.slice(2);
const recipes = selected.length ? selected : ['ui', 'query', 'stream'];
const results = [];
for (const recipe of recipes) {
  if (!['ui', 'query', 'stream'].includes(recipe))
    throw new Error('Unknown recipe');
  const { project, temporary } = copyProject(root, 'recipe-' + recipe);
  let passed = false,
    stage = 'initialize recipe project',
    failure;
  const copy = (source, target) => {
    const destination = path.join(project, target);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(
      destination,
      readFileSync(
        path.join(root, '.scaffold/recipes', recipe, source),
        'utf8',
      ).replaceAll('@proj', '@recipe-check'),
    );
  };
  const edit = (relative, from, to) => {
    const file = path.join(project, relative);
    const text = readFileSync(file, 'utf8');
    if (!text.includes(from))
      throw new Error('Recipe registration target missing: ' + relative);
    writeFileSync(
      file,
      text.replace(from, () => to),
    );
  };
  try {
    execFileSync(
      process.execPath,
      [
        'scripts/init.mjs',
        '--name',
        'recipe-check',
        '--scope',
        '@recipe-check',
        '--allow-occupied-ports',
      ],
      { cwd: project, stdio: 'inherit' },
    );
    appendFileSync(path.join(project, '.env'), '\nAPP_DATA_DIR=.runtime\n');
    stage = 'install locked dependencies';
    runPnpmSync(['install', '--frozen-lockfile'], {
      cwd: project,
      stdio: 'inherit',
    });
    if (recipe === 'ui' || recipe === 'query') {
      stage = `apply ${recipe} recipe`;
      // Keep base interaction coverage in the fixture while testing the replacement separately.
      copyFileSync(
        path.join(project, 'packages/frontend/src/pages/HomePage.tsx'),
        path.join(project, 'packages/frontend/src/pages/BaseHomePage.tsx'),
      );
      edit(
        'packages/frontend/test/index.test.tsx',
        '../src/pages/HomePage',
        '../src/pages/BaseHomePage',
      );
      runPnpmSync(
        [
          '--filter',
          '@recipe-check/frontend',
          'add',
          recipe === 'ui' ? 'antd@6.4.3' : '@tanstack/react-query@5',
          '--registry',
          'https://registry.npmjs.org',
        ],
        { cwd: project, stdio: 'inherit' },
      );
      copy('ItemsPage.tsx', 'packages/frontend/src/pages/HomePage.tsx');
      copy(
        recipe + '.test.tsx',
        'packages/frontend/test/' + recipe + '.test.tsx',
      );
    } else {
      stage = 'apply stream recipe';
      copy('contract.ts', 'packages/api/src/chat.ts');
      edit(
        'packages/api/src/index.ts',
        "export * from './contract';",
        "export * from './contract';\nexport * from './chat';",
      );
      copy('server.ts', 'packages/webui/src/chat.ts');
      edit(
        'packages/webui/src/index.ts',
        "import { createApp } from './app';",
        "import { createApp } from './app';\nimport { registerChat } from './chat';",
      );
      edit(
        'packages/webui/src/index.ts',
        "logger.log('info', 'app.starting');",
        "registerChat(runtime.app,logger);\nlogger.log('info', 'app.starting');",
      );
      copy('client.ts', 'packages/frontend/src/api/chat.ts');
      copy('ChatPage.tsx', 'packages/frontend/src/pages/ChatPage.tsx');
      copy('stream.test.ts', 'packages/frontend/test/stream.test.ts');
      copy('server.test.ts', 'packages/webui/test/chat.test.ts');
      edit(
        'packages/frontend/src/App.tsx',
        'const routes = [',
        "const routes = [{path:'/chat',label:'Chat',component:lazy(()=>import('./pages/ChatPage').then(module=>({default:module.ChatPage})))},",
      );
    }
    execFileSync('git', ['add', '.'], { cwd: project, stdio: 'ignore' });
    stage = `verify ${recipe} recipe`;
    runPnpmSync(['verify'], { cwd: project, stdio: 'inherit' });
    stage = `verify ${recipe} frozen reinstall`;
    runPnpmSync(['install', '--frozen-lockfile', '--offline'], {
      cwd: project,
      stdio: 'inherit',
    });
    const assets = path.join(project, 'packages/frontend/dist/assets');
    const sizes = readdirSync(assets)
      .filter((f) => f.endsWith('.js'))
      .map((f) => {
        const bytes = readFileSync(path.join(assets, f));
        return { file: f, bytes: bytes.length, gzip: gzipSync(bytes).length };
      });
    results.push({
      recipe,
      verifiedAt: new Date().toISOString(),
      sizes,
      installedEntries: readdirSync(path.join(project, 'node_modules/.pnpm'))
        .length,
    });
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(
      path.join(config.dataDir, 'recipe-validation.json'),
      JSON.stringify(results, null, 2),
    );
    console.log('Recipe validated: ' + recipe + ' ' + JSON.stringify(sizes));
    passed = true;
  } catch (error) {
    failure = error;
  } finally {
    const cleanup = finalizeVerificationCopy({
      temporary,
      project,
      completed: passed,
      stage,
      label: `Recipe verification (${recipe})`,
    });
    if (passed && !cleanup.cleaned)
      failure = new Error('RECIPE_VERIFICATION_TEMP_CLEANUP_FAILED');
  }
  if (failure) throw failure;
}
