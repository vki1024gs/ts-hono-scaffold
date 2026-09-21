import type { Item } from '@proj/core';
import type {
  PortableSettingsRepository,
  SettingsBackup,
  SettingsCodec,
  SettingsRepository,
} from '@proj/core';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export interface ItemsRepository {
  list(): Promise<Item[]>;
  create(name: string): Promise<Item>;
  update(id: string, name: string): Promise<Item | null>;
  delete(id: string): Promise<boolean>;
}
export function createMemoryItems(
  options: { id?: () => string; now?: () => string } = {},
): ItemsRepository {
  const items = new Map<string, Item>();
  const copy = (item: Item) => ({ ...item });
  return {
    async list() {
      return [...items.values()].map(copy);
    },
    async create(name) {
      const item = {
        id: options.id?.() ?? crypto.randomUUID(),
        name,
        createdAt: options.now?.() ?? new Date().toISOString(),
      };
      items.set(item.id, item);
      return copy(item);
    },
    async update(id, name) {
      const item = items.get(id);
      if (!item) return null;
      item.name = name;
      return copy(item);
    },
    async delete(id) {
      return items.delete(id);
    },
  };
}

export function createMemorySettingsRepository<T>(
  initial: T | null = null,
): SettingsRepository<T> {
  let value = initial;
  return {
    async load() {
      return value;
    },
    async save(next) {
      value = next;
    },
  };
}

type SettingsFileSystem = {
  readFile(file: string, encoding: 'utf8'): Promise<string>;
  writeFile(
    file: string,
    data: string,
    options: { encoding: 'utf8'; mode: number; flag: string },
  ): Promise<unknown>;
  mkdir(
    directory: string,
    options: { recursive: true; mode: number },
  ): Promise<unknown>;
  rename(source: string, target: string): Promise<void>;
  unlink(file: string): Promise<void>;
  readdir(directory: string): Promise<string[]>;
};

const nodeFileSystem: SettingsFileSystem = {
  readFile: (file, encoding) => fs.readFile(file, encoding),
  writeFile: (file, data, options) => fs.writeFile(file, data, options),
  mkdir: (directory, options) => fs.mkdir(directory, options),
  rename: (source, target) => fs.rename(source, target),
  unlink: (file) => fs.unlink(file),
  readdir: (directory) => fs.readdir(directory),
};

export class SettingsStorageError extends Error {
  constructor(
    public readonly code:
      | 'SETTINGS_BACKUP_INVALID'
      | 'SETTINGS_BACKUP_FAILED'
      | 'SETTINGS_BACKUP_NOT_FOUND'
      | 'SETTINGS_ROLLBACK_FAILED'
      | 'SETTINGS_WRITE_FAILED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SettingsStorageError';
  }
}

type BackupRecord = {
  backupSchemaVersion: 1;
  id: string;
  applicationId: string;
  documentType: string;
  createdAt: string;
  reason: SettingsBackup['reason'];
  document: string;
};

const safeName = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'settings';

export function createFileSettingsRepository<T>(options: {
  file: string;
  codec: SettingsCodec<T>;
  backupDir?: string;
  maxBackups?: number;
  now?: () => string;
  id?: () => string;
  fileSystem?: SettingsFileSystem;
}): PortableSettingsRepository<T> {
  const file = path.resolve(options.file);
  const backupDir = path.resolve(
    options.backupDir ?? path.join(path.dirname(file), 'backup'),
  );
  const io = options.fileSystem ?? nodeFileSystem;
  const maxBackups = options.maxBackups ?? 10;
  if (!Number.isInteger(maxBackups) || maxBackups < 1)
    throw new SettingsStorageError(
      'SETTINGS_WRITE_FAILED',
      'Settings backup retention must be a positive integer',
    );
  const backupPrefix = `${safeName(options.codec.documentType)}.`;
  const backupFile = (id: string) =>
    path.join(backupDir, `${backupPrefix}${id}.backup.json`);
  const readCurrent = async () => {
    try {
      return await io.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const parseBackup = (text: string): BackupRecord => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new SettingsStorageError(
        'SETTINGS_BACKUP_INVALID',
        'Settings backup is not valid JSON',
      );
    }
    const record = value as Partial<BackupRecord>;
    if (
      record.backupSchemaVersion !== 1 ||
      typeof record.id !== 'string' ||
      record.applicationId !== options.codec.applicationId ||
      record.documentType !== options.codec.documentType ||
      typeof record.createdAt !== 'string' ||
      !['migration', 'import', 'restore'].includes(String(record.reason)) ||
      typeof record.document !== 'string'
    )
      throw new SettingsStorageError(
        'SETTINGS_BACKUP_INVALID',
        'Settings backup envelope is invalid or belongs to another document',
      );
    return record as BackupRecord;
  };
  const listBackupRecords = async () => {
    let names: string[];
    try {
      names = await io.readdir(backupDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const records: BackupRecord[] = [];
    for (const name of names.filter(
      (entry) =>
        entry.startsWith(backupPrefix) && entry.endsWith('.backup.json'),
    )) {
      try {
        records.push(
          parseBackup(await io.readFile(path.join(backupDir, name), 'utf8')),
        );
      } catch {
        // Invalid files are never considered restorable backups.
      }
    }
    return records.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  };
  const pruneBackups = async () => {
    const records = await listBackupRecords();
    await Promise.all(
      records
        .slice(maxBackups)
        .map((record) => io.unlink(backupFile(record.id)).catch(() => {})),
    );
  };
  const createBackup = async (
    document: string,
    reason: SettingsBackup['reason'],
  ) => {
    const id = options.id?.() ?? randomUUID();
    const record: BackupRecord = {
      backupSchemaVersion: 1,
      id,
      applicationId: options.codec.applicationId,
      documentType: options.codec.documentType,
      createdAt: options.now?.() ?? new Date().toISOString(),
      reason,
      document,
    };
    try {
      await io.mkdir(backupDir, { recursive: true, mode: 0o700 });
      await io.writeFile(
        backupFile(id),
        `${JSON.stringify(record, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' },
      );
    } catch (error) {
      throw new SettingsStorageError(
        'SETTINGS_BACKUP_FAILED',
        'Settings backup could not be created; stored data was not changed',
        { cause: error },
      );
    }
    await pruneBackups().catch(() => {});
    return record;
  };
  const restoreBytes = async (previous: string | null) => {
    if (previous === null) {
      await io.unlink(file).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
      return;
    }
    const recovery = `${file}.${process.pid}-${randomUUID()}.rollback.tmp`;
    try {
      await io.writeFile(recovery, previous, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await io.rename(recovery, file);
    } finally {
      await io.unlink(recovery).catch(() => {});
    }
  };
  const replace = async (value: T, previous: string | null) => {
    const directory = path.dirname(file);
    await io.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}-${randomUUID()}.tmp`;
    let replaced = false;
    try {
      const serialized = options.codec.serialize(value);
      options.codec.prepareImport(serialized);
      await io.writeFile(temporary, serialized, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      options.codec.prepareImport(await io.readFile(temporary, 'utf8'));
      await io.rename(temporary, file);
      replaced = true;
      options.codec.prepareImport(await io.readFile(file, 'utf8'));
    } catch (error) {
      await io.unlink(temporary).catch(() => {});
      if (replaced) {
        try {
          await restoreBytes(previous);
        } catch (rollbackError) {
          throw new SettingsStorageError(
            'SETTINGS_ROLLBACK_FAILED',
            'Settings write failed and the previous file could not be restored',
            { cause: rollbackError },
          );
        }
      }
      if (error instanceof SettingsStorageError) throw error;
      throw new SettingsStorageError(
        'SETTINGS_WRITE_FAILED',
        'Settings could not be written and verified',
        { cause: error },
      );
    }
  };
  return {
    async load() {
      const current = await readCurrent();
      if (current === null) return null;
      const prepared = options.codec.prepareImport(current);
      if (prepared.migrated) {
        await createBackup(current, 'migration');
        await replace(prepared.value, current);
      }
      return prepared.value;
    },
    async save(value) {
      await replace(value, await readCurrent());
    },
    async previewImport(input) {
      const prepared = options.codec.prepareImport(input);
      return {
        sourceVersion: prepared.sourceVersion,
        targetVersion: prepared.targetVersion,
        migrated: prepared.migrated,
      };
    },
    async importSettings(input) {
      const prepared = options.codec.prepareImport(input);
      const current = await readCurrent();
      if (current !== null) await createBackup(current, 'import');
      await replace(prepared.value, current);
      return prepared.value;
    },
    async listBackups() {
      return (await listBackupRecords()).map(({ id, createdAt, reason }) => ({
        id,
        createdAt,
        reason,
      }));
    },
    async restoreBackup(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id))
        throw new SettingsStorageError(
          'SETTINGS_BACKUP_NOT_FOUND',
          'Settings backup was not found',
        );
      let record: BackupRecord;
      try {
        record = parseBackup(await io.readFile(backupFile(id), 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          throw new SettingsStorageError(
            'SETTINGS_BACKUP_NOT_FOUND',
            'Settings backup was not found',
          );
        throw error;
      }
      const prepared = options.codec.prepareImport(record.document);
      const current = await readCurrent();
      if (current !== null) await createBackup(current, 'restore');
      await replace(prepared.value, current);
      return prepared.value;
    },
  };
}
