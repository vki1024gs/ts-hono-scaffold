import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { finalizeVerificationCopy } from './lib/generated.mjs';

const fixture = () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'scaffold-cleanup-test-'));
  const project = path.join(temporary, 'project');
  writeFileSync(project, 'inspection fixture');
  return { temporary, project };
};

test('failed generated verification removes its copy by default', () => {
  const copy = fixture();
  const reports = [];
  const result = finalizeVerificationCopy({
    ...copy,
    completed: false,
    stage: 'format check',
    environment: {},
    report: (message) => reports.push(message),
  });
  assert.deepEqual(result, { cleaned: true, retained: false });
  assert.equal(existsSync(copy.temporary), false);
  assert.match(reports[0], /format check/);
  assert.match(reports[0], /SCAFFOLD_KEEP_FAILED_VERIFY=1/);
});

test('failed generated verification is retained only by explicit opt-in', () => {
  const copy = fixture();
  const reports = [];
  try {
    const result = finalizeVerificationCopy({
      ...copy,
      completed: false,
      stage: 'runtime check',
      environment: { SCAFFOLD_KEEP_FAILED_VERIFY: '1' },
      report: (message) => reports.push(message),
    });
    assert.deepEqual(result, { cleaned: false, retained: true });
    assert.equal(existsSync(copy.temporary), true);
    assert.match(reports[0], /runtime check/);
    assert.ok(reports[0].includes(copy.project));
  } finally {
    rmSync(copy.temporary, { recursive: true, force: true });
  }
});

test('successful generated verification always removes its copy', () => {
  const copy = fixture();
  const result = finalizeVerificationCopy({
    ...copy,
    completed: true,
    stage: 'complete',
    environment: { SCAFFOLD_KEEP_FAILED_VERIFY: '1' },
    report: () => {},
  });
  assert.deepEqual(result, { cleaned: true, retained: false });
  assert.equal(existsSync(copy.temporary), false);
});
