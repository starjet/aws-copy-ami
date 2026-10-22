import pc from "picocolors";

/**
 * Thin logging surface used across every command so formatting stays
 * consistent. Diagnostics go to stderr; machine-relevant results go to stdout.
 */

export function info(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function step(message: string): void {
  process.stderr.write(`${pc.cyan("→")} ${message}\n`);
}

export function success(message: string): void {
  process.stderr.write(`${pc.green("✓")} ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${pc.yellow("!")} ${message}\n`);
}

export function error(message: string): void {
  process.stderr.write(`${pc.red("✗")} ${message}\n`);
}

export function result(message: string): void {
  process.stdout.write(`${message}\n`);
}

let progressActive = false;

/** Overwrite a single status line in place (TTY only; falls back to lines). */
export function progress(message: string): void {
  if (process.stderr.isTTY) {
    progressActive = true;
    process.stderr.write(`\r${pc.dim("…")} ${message}\u001b[K`);
  } else {
    process.stderr.write(`${message}\n`);
  }
}

/** Finish an in-progress line started by `progress`. */
export function progressDone(): void {
  if (progressActive && process.stderr.isTTY) {
    process.stderr.write("\n");
    progressActive = false;
  }
}
