import { expect, test } from 'vitest';
import { APP_VERSION } from '../src';
import manifest from '../package.json';
test('runtime identity matches the release manifest', () =>
  expect(APP_VERSION).toBe(manifest.version));
