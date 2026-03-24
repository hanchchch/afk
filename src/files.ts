import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";

async function acquire(lockFile: string, timeout: number): Promise<void> {
  const startTime = Date.now();
  const interval = 100;
  while (true) {
    if (!existsSync(lockFile)) {
      writeFileSync(lockFile, "");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (Date.now() - startTime > timeout) {
      throw new Error("Timeout acquiring lock");
    }
  }
}

function release(lockFile: string): void {
  try {
    unlinkSync(lockFile);
  } catch (error) {
    console.error(`Failed to release lock file: ${error}`);
  }
}

export async function withLock<T>(
  { file, timeout }: { file: string; timeout: number },
  fn: (file: string) => T | Promise<T>,
): Promise<T> {
  const lockFile = file + ".lock";
  await acquire(lockFile, timeout);
  try {
    return await fn(file);
  } finally {
    release(lockFile);
  }
}

export function tryRead(file: string): string | null {
  if (!existsSync(file)) {
    return null;
  }
  try {
    return readFileSync(file, "utf-8").trim();
  } catch (error) {
    return null;
  }
}
