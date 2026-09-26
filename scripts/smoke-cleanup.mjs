import { rmSync } from "node:fs";

// The callback is synchronous and must finish its children before returning.
// Only pass a directory created by this smoke run.
export function withSmokeCleanup(directory, run, remove = rmSync) {
  let failed = false;
  let failure;
  try {
    return run();
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    try {
      // Windows may briefly retain handles to the installed runtime. Six linear-backoff retries
      // at 250ms yield a bounded 5.25-second wait; persistent failures must still fail CI.
      remove(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
    } catch (cleanupError) {
      if (failed) throw new AggregateError([failure, cleanupError], "Smoke and temporary-directory cleanup both failed");
      throw cleanupError;
    }
  }
}
