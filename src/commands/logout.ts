import { clearConfig, configPath } from "../config";
import * as log from "../logger";

export function logoutCommand(): void {
  if (clearConfig()) {
    log.success(`Removed saved configuration at ${configPath()}.`);
  } else {
    log.info("No saved configuration to remove.");
  }
}
