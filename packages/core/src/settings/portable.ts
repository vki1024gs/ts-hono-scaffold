import type { JsonObject, JsonValue, SettingsDocument } from './model';

export type SettingsMigration = (
  document: SettingsDocument,
) => SettingsDocument;

export class SettingsError extends Error {
  constructor(
    public readonly code:
      | 'SETTINGS_JSON_INVALID'
      | 'SETTINGS_DOCUMENT_INVALID'
      | 'SETTINGS_APPLICATION_MISMATCH'
      | 'SETTINGS_DOCUMENT_TYPE_MISMATCH'
      | 'SETTINGS_VERSION_UNSUPPORTED'
      | 'SETTINGS_MIGRATION_MISSING'
      | 'SETTINGS_MIGRATION_INVALID'
      | 'SETTINGS_DATA_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'SettingsError';
  }
}

export type SettingsCodec<T> = {
  readonly applicationId: string;
  readonly documentType: string;
  readonly currentVersion: number;
  prepareImport(input: string | unknown): PreparedSettings<T>;
  importSettings(input: string | unknown): T;
  exportSettings(value: T): SettingsDocument;
  serialize(value: T): string;
};

type SettingsCodecOptions<T> = {
  applicationId: string;
  documentType: string;
  currentVersion: number;
  decode(data: JsonObject): T;
  encode(value: T): JsonObject;
  migrations?: Readonly<Record<number, SettingsMigration>>;
};

export type PreparedSettings<T> = {
  value: T;
  document: SettingsDocument;
  sourceVersion: number;
  targetVersion: number;
  migrated: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function normalizeJson(value: unknown, path = '$'): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map((item, index) => normalizeJson(item, `${path}[${index}]`));
  if (isObject(value)) {
    const result: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new SettingsError(
          'SETTINGS_DATA_INVALID',
          `Unsafe settings key at ${path}.${key}`,
        );
      result[key] = normalizeJson(value[key], `${path}.${key}`);
    }
    return result;
  }
  throw new SettingsError(
    'SETTINGS_DATA_INVALID',
    `Settings contain a non-JSON value at ${path}`,
  );
}

function parseDocument(input: string | unknown): SettingsDocument {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      throw new SettingsError(
        'SETTINGS_JSON_INVALID',
        'Settings are not valid JSON',
      );
    }
  }
  if (!isObject(value))
    throw new SettingsError(
      'SETTINGS_DOCUMENT_INVALID',
      'Settings document must be an object',
    );
  if (
    !Number.isInteger(value.schemaVersion) ||
    Number(value.schemaVersion) < 1 ||
    typeof value.applicationId !== 'string' ||
    typeof value.documentType !== 'string' ||
    !value.documentType ||
    !isObject(value.data)
  )
    throw new SettingsError(
      'SETTINGS_DOCUMENT_INVALID',
      'Settings envelope is invalid',
    );
  return normalizeJson(value) as SettingsDocument;
}

export function createSettingsCodec<T>(
  options: SettingsCodecOptions<T>,
): SettingsCodec<T> {
  if (
    !options.applicationId ||
    !options.documentType ||
    !Number.isInteger(options.currentVersion) ||
    options.currentVersion < 1
  )
    throw new SettingsError(
      'SETTINGS_DOCUMENT_INVALID',
      'Settings codec identity, document type, or version is invalid',
    );
  const migrate = (input: SettingsDocument) => {
    let document = input;
    if (document.applicationId !== options.applicationId)
      throw new SettingsError(
        'SETTINGS_APPLICATION_MISMATCH',
        'Settings belong to another application',
      );
    if (document.documentType !== options.documentType)
      throw new SettingsError(
        'SETTINGS_DOCUMENT_TYPE_MISMATCH',
        'Settings are for another document type',
      );
    if (document.schemaVersion > options.currentVersion)
      throw new SettingsError(
        'SETTINGS_VERSION_UNSUPPORTED',
        'Settings were created by a newer application version',
      );
    while (document.schemaVersion < options.currentVersion) {
      const migration = options.migrations?.[document.schemaVersion];
      if (!migration)
        throw new SettingsError(
          'SETTINGS_MIGRATION_MISSING',
          `No settings migration is registered for schema version ${document.schemaVersion}`,
        );
      const previous = document.schemaVersion;
      document = parseDocument(migration(document));
      if (
        document.applicationId !== options.applicationId ||
        document.documentType !== options.documentType ||
        document.schemaVersion !== previous + 1
      )
        throw new SettingsError(
          'SETTINGS_MIGRATION_INVALID',
          'Settings migration did not advance exactly one version',
        );
    }
    return document;
  };
  const exportSettings = (value: T): SettingsDocument => {
    let data: JsonObject;
    try {
      const normalized = normalizeJson(options.encode(value));
      if (!isObject(normalized)) throw new Error();
      data = normalized as JsonObject;
    } catch (error) {
      if (error instanceof SettingsError) throw error;
      throw new SettingsError(
        'SETTINGS_DATA_INVALID',
        'Settings cannot be exported',
      );
    }
    return {
      schemaVersion: options.currentVersion,
      applicationId: options.applicationId,
      documentType: options.documentType,
      data,
    };
  };
  const prepareImport = (input: string | unknown): PreparedSettings<T> => {
    const parsed = parseDocument(input);
    const sourceVersion = parsed.schemaVersion;
    const document = migrate(parsed);
    let value: T;
    try {
      value = options.decode(document.data);
    } catch (error) {
      if (error instanceof SettingsError) throw error;
      throw new SettingsError(
        'SETTINGS_DATA_INVALID',
        'Settings data are invalid',
      );
    }
    const canonical = exportSettings(value);
    return {
      value,
      document: canonical,
      sourceVersion,
      targetVersion: options.currentVersion,
      migrated: sourceVersion !== options.currentVersion,
    };
  };
  return {
    applicationId: options.applicationId,
    documentType: options.documentType,
    currentVersion: options.currentVersion,
    prepareImport,
    importSettings(input) {
      return prepareImport(input).value;
    },
    exportSettings,
    serialize(value) {
      return `${JSON.stringify(exportSettings(value), null, 2)}\n`;
    },
  };
}
