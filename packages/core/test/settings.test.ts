import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { SettingsError, createSettingsCodec } from '../src';

type Settings = { title: string; theme: 'system' | 'dark'; token?: string };
const codec = createSettingsCodec<Settings>({
  applicationId: 'fixture-app',
  documentType: 'user-settings',
  currentVersion: 3,
  migrations: {
    1: (document) => ({
      ...document,
      schemaVersion: 2,
      data: {
        title: String(document.data.name ?? ''),
        theme: document.data.theme === 'dark' ? 'dark' : 'system',
      },
    }),
    2: (document) => ({
      ...document,
      schemaVersion: 3,
      data: {
        ...document.data,
        theme: document.data.theme === 'dark' ? 'dark' : 'system',
      },
    }),
  },
  decode(data) {
    if (
      typeof data.title !== 'string' ||
      !data.title.trim() ||
      !['system', 'dark'].includes(String(data.theme))
    )
      throw new Error('invalid title');
    const value: Settings = {
      title: data.title,
      theme: data.theme as Settings['theme'],
    };
    if (typeof data.token === 'string') value.token = data.token;
    return value;
  },
  encode(value) {
    // Secrets are deliberately excluded by the application-owned encoder.
    return { theme: value.theme, title: value.title };
  },
});

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/settings/${name}`, import.meta.url), 'utf8');

describe('versioned portable user settings', () => {
  test('exports deterministically and imports without secrets', () => {
    const text = codec.serialize({
      title: 'Dashboard',
      theme: 'dark',
      token: 'private',
    });
    expect(text).toBe(
      fixture('expected-current.json'),
    );
    expect(codec.importSettings(text)).toEqual({
      title: 'Dashboard',
      theme: 'dark',
    });
  });

  test('migrates every retained historical fixture to the canonical version', () => {
    for (const name of ['v1.json', 'v2.json', 'v3.json']) {
      const prepared = codec.prepareImport(fixture(name));
      expect(prepared.value).toEqual({ title: 'Dashboard', theme: 'dark' });
      expect(prepared.targetVersion).toBe(3);
      expect(prepared.migrated).toBe(name !== 'v3.json');
      expect(`${JSON.stringify(prepared.document, null, 2)}\n`).toBe(
        fixture('expected-current.json'),
      );
    }
  });

  test('rejects future versions and preserves structured errors', () => {
    expect(() => codec.importSettings(fixture('future.json'))).toThrowError(
      SettingsError,
    );
    try {
      codec.importSettings(fixture('future.json'));
    } catch (error) {
      expect((error as SettingsError).code).toBe('SETTINGS_VERSION_UNSUPPORTED');
    }
  });

  test('rejects corrupt, wrong-application, and wrong-document inputs distinctly', () => {
    expectSettingsCode(fixture('corrupt.json'), 'SETTINGS_JSON_INVALID');
    expectSettingsCode(
      fixture('wrong-application.json'),
      'SETTINGS_APPLICATION_MISMATCH',
    );
    expectSettingsCode(
      fixture('wrong-document.json'),
      'SETTINGS_DOCUMENT_TYPE_MISMATCH',
    );
  });

  test('refuses to skip a missing migration step', () => {
    const incomplete = createSettingsCodec<Settings>({
      applicationId: 'fixture-app',
      documentType: 'user-settings',
      currentVersion: 3,
      migrations: {
        1: (document) => ({ ...document, schemaVersion: 2 }),
      },
      decode: () => ({ title: 'unused', theme: 'system' }),
      encode: (value) => ({ title: value.title, theme: value.theme }),
    });
    expect(() => incomplete.importSettings(fixture('v1.json'))).toThrowError(
      expect.objectContaining({ code: 'SETTINGS_MIGRATION_MISSING' }),
    );
  });
});

function expectSettingsCode(input: string, code: SettingsError['code']) {
  try {
    codec.importSettings(input);
    throw new Error('Expected settings import to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(SettingsError);
    expect((error as SettingsError).code).toBe(code);
  }
}
