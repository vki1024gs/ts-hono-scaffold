import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createSettingsCodec } from '@proj/core';
import {
  createFileSettingsRepository,
  createMemorySettingsRepository,
  SettingsStorageError,
} from '../src';

const codec = createSettingsCodec<{ title: string }>({
  applicationId: 'repository-fixture',
  documentType: 'user-settings',
  currentVersion: 2,
  migrations: {
    1: (document) => ({
      ...document,
      schemaVersion: 2,
      data: { title: String(document.data.name ?? '') },
    }),
  },
  decode(data) {
    if (typeof data.title !== 'string' || !data.title.trim())
      throw new Error('invalid title');
    return { title: data.title };
  },
  encode(value) {
    return { title: value.title };
  },
});

const oldDocument = `${JSON.stringify(
  {
    schemaVersion: 1,
    applicationId: 'repository-fixture',
    documentType: 'user-settings',
    data: { name: 'Legacy' },
  },
  null,
  2,
)}\n`;

describe('settings repositories', () => {
  test('memory repository is injectable', async () => {
    const repository = createMemorySettingsRepository<{ title: string }>();
    expect(await repository.load()).toBeNull();
    await repository.save({ title: 'Memory' });
    expect(await repository.load()).toEqual({ title: 'Memory' });
  });

  test('file repository writes atomically and reads through the codec', async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'settings-repository-'),
    );
    const file = path.join(root, 'settings', 'settings.json');
    const repository = createFileSettingsRepository({ file, codec });
    expect(await repository.load()).toBeNull();
    await repository.save({ title: 'Stored' });
    expect(await repository.load()).toEqual({ title: 'Stored' });
    expect(await fs.readFile(file, 'utf8')).toContain('"schemaVersion": 2');
    expect(await fs.readFile(file, 'utf8')).toContain(
      '"documentType": "user-settings"',
    );
  });

  test('loading an old document backs up exact bytes and persists migration', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-migrate-'));
    const file = path.join(root, 'settings', 'settings.json');
    const backupDir = path.join(root, 'backup');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, oldDocument);
    const repository = createFileSettingsRepository({
      file,
      backupDir,
      codec,
      id: () => '00000000-0000-4000-8000-000000000001',
      now: () => '2026-09-20T00:00:00.000Z',
    });

    expect(await repository.load()).toEqual({ title: 'Legacy' });
    expect(JSON.parse(await fs.readFile(file, 'utf8')).schemaVersion).toBe(2);
    expect(await repository.listBackups()).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        createdAt: '2026-09-20T00:00:00.000Z',
        reason: 'migration',
      },
    ]);
    const storedBackup = JSON.parse(
      await fs.readFile(
        path.join(
          backupDir,
          'user-settings.00000000-0000-4000-8000-000000000001.backup.json',
        ),
        'utf8',
      ),
    );
    expect(storedBackup.document).toBe(oldDocument);
  });

  test('import preview writes nothing and commit is backup protected', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-import-'));
    const file = path.join(root, 'settings.json');
    const backupDir = path.join(root, 'backup');
    const ids = [
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ];
    const repository = createFileSettingsRepository({
      file,
      backupDir,
      codec,
      id: () => ids.shift()!,
      now: () => '2026-09-20T00:00:00.000Z',
    });
    await repository.save({ title: 'Current' });
    const before = await fs.readFile(file, 'utf8');

    expect(await repository.previewImport(oldDocument)).toEqual({
      sourceVersion: 1,
      targetVersion: 2,
      migrated: true,
    });
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(await repository.listBackups()).toEqual([]);

    await expect(repository.importSettings(oldDocument)).resolves.toEqual({
      title: 'Legacy',
    });
    expect(await repository.listBackups()).toHaveLength(1);
    await expect(
      repository.restoreBackup('00000000-0000-4000-8000-000000000002'),
    ).resolves.toEqual({ title: 'Current' });
    expect(await repository.load()).toEqual({ title: 'Current' });
  });

  test('failed serialization preserves the last valid file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-preserve-'));
    const file = path.join(root, 'settings.json');
    const repository = createFileSettingsRepository({ file, codec });
    await repository.save({ title: 'Valid' });
    const before = await fs.readFile(file, 'utf8');
    await expect(
      repository.save({ title: Number.NaN as unknown as string }),
    ).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  test('post-replace verification failure restores exact previous bytes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-rollback-'));
    const file = path.join(root, 'settings.json');
    const normal = createFileSettingsRepository({ file, codec });
    await normal.save({ title: 'Original' });
    const before = await fs.readFile(file, 'utf8');
    let corruptNextTargetRead = false;
    const fileSystem = {
      readFile: async (target: string, encoding: 'utf8') => {
        if (target === file && corruptNextTargetRead) {
          corruptNextTargetRead = false;
          return '{broken';
        }
        return fs.readFile(target, encoding);
      },
      writeFile: (
        target: string,
        data: string,
        options: { encoding: 'utf8'; mode: number; flag: string },
      ) => fs.writeFile(target, data, options),
      mkdir: (target: string, options: { recursive: true; mode: number }) =>
        fs.mkdir(target, options),
      rename: async (source: string, target: string) => {
        await fs.rename(source, target);
        if (target === file && !source.includes('.rollback.tmp'))
          corruptNextTargetRead = true;
      },
      unlink: (target: string) => fs.unlink(target),
      readdir: (target: string) => fs.readdir(target),
    };
    const repository = createFileSettingsRepository({
      file,
      codec,
      fileSystem,
    });

    await expect(
      repository.save({ title: 'Replacement' }),
    ).rejects.toMatchObject({
      code: 'SETTINGS_WRITE_FAILED',
    } satisfies Partial<SettingsStorageError>);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  test('future imports fail without backup or stored-data changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-future-'));
    const file = path.join(root, 'settings.json');
    const repository = createFileSettingsRepository({ file, codec });
    await repository.save({ title: 'Current' });
    const before = await fs.readFile(file, 'utf8');
    await expect(
      repository.importSettings({
        schemaVersion: 3,
        applicationId: 'repository-fixture',
        documentType: 'user-settings',
        data: { title: 'Future' },
      }),
    ).rejects.toMatchObject({ code: 'SETTINGS_VERSION_UNSUPPORTED' });
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(await repository.listBackups()).toEqual([]);
  });

  test('backup retention is bounded without blocking successful imports', async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'settings-retention-'),
    );
    const file = path.join(root, 'settings.json');
    const ids = [1, 2, 3].map(
      (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`,
    );
    let tick = 0;
    const repository = createFileSettingsRepository({
      file,
      codec,
      maxBackups: 2,
      id: () => ids.shift()!,
      now: () => `2026-09-20T00:00:0${tick++}.000Z`,
    });
    await repository.save({ title: 'Initial' });
    for (const title of ['One', 'Two', 'Three'])
      await repository.importSettings(codec.serialize({ title }));
    const backups = await repository.listBackups();
    expect(backups).toHaveLength(2);
    expect(backups.map((backup) => backup.id)).toEqual([
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
    ]);
  });
});
