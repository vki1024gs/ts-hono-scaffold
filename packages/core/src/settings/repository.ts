export interface SettingsRepository<T> {
  load(): Promise<T | null>;
  save(value: T): Promise<void>;
}

export type SettingsImportPreview = {
  sourceVersion: number;
  targetVersion: number;
  migrated: boolean;
};

export type SettingsBackup = {
  id: string;
  createdAt: string;
  reason: 'migration' | 'import' | 'restore';
};

export interface PortableSettingsRepository<T> extends SettingsRepository<T> {
  previewImport(input: string | unknown): Promise<SettingsImportPreview>;
  importSettings(input: string | unknown): Promise<T>;
  listBackups(): Promise<SettingsBackup[]>;
  restoreBackup(id: string): Promise<T>;
}
