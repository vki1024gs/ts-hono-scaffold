import { randomUUID } from 'node:crypto';
import { open, readFile, unlink } from 'node:fs/promises';

const processAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export async function withOperationLock({
  action,
  lockFile,
  projectRoot,
  operation,
  alive = processAlive,
}) {
  let lock;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lock = await open(lockFile, 'wx', 0o600);
      await lock.writeFile(
        `${JSON.stringify({
          schemaVersion: 1,
          projectRoot,
          pid: process.pid,
          action,
          operationId: randomUUID(),
          startedAt: new Date().toISOString(),
        })}\n`,
      );
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try {
        owner = JSON.parse(await readFile(lockFile, 'utf8'));
      } catch {}
      if (
        attempt === 0 &&
        owner?.schemaVersion === 1 &&
        owner.projectRoot === projectRoot &&
        Number.isInteger(owner.pid) &&
        !alive(owner.pid)
      ) {
        await unlink(lockFile).catch(() => {});
        continue;
      }
      throw new Error(
        `OPERATION_BUSY: Another lifecycle action blocks ${action}.`,
        { cause: error },
      );
    }
  }
  try {
    return await operation();
  } finally {
    await lock.close();
    await unlink(lockFile).catch(() => {});
  }
}
