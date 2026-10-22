import { homedir } from "node:os";
import { join } from "node:path";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

/**
 * Credentials/region persisted locally by `ami-to-s3 login --save`.
 * Stored at ~/.ami-to-s3/config.json with 0600 permissions. Secrets are
 * written in plaintext, so prefer `profile` over inline keys when possible.
 */
export interface StoredConfig {
  region?: string;
  profile?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

const CONFIG_DIR = join(homedir(), ".ami-to-s3");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function configPath(): string {
  return CONFIG_FILE;
}

export function loadConfig(): StoredConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    if (parsed && typeof parsed === "object") return parsed as StoredConfig;
    return {};
  } catch {
    throw new Error(`Config file at ${CONFIG_FILE} is corrupt. Delete it or run "ami-to-s3 logout".`);
  }
}

export function saveConfig(config: StoredConfig): string {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
  return CONFIG_FILE;
}

export function clearConfig(): boolean {
  if (!existsSync(CONFIG_FILE)) return false;
  rmSync(CONFIG_FILE, { force: true });
  return true;
}
