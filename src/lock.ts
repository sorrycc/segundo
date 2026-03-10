import { openSync, closeSync, unlinkSync, statSync, constants } from "fs";

const LOCK_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 50;

export async function acquireLock(lockPath: string): Promise<void> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const fd = openSync(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      );
      closeSync(fd);
      return;
    } catch (e: any) {
      if (e.code === "EEXIST") {
        try {
          const stat = statSync(lockPath);
          if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT_MS) {
            unlinkSync(lockPath);
            continue;
          }
        } catch {
          continue;
        }
        await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** i));
      } else {
        throw e;
      }
    }
  }
  throw new Error(
    `Could not acquire lock on ${lockPath}. Another process may be writing.`,
  );
}

export function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {}
}

export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    releaseLock(lockPath);
  }
}
