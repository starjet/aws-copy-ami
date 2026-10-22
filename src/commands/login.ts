import prompts from "prompts";
import type { CredentialOptions } from "../aws/credentials";
import { resolveAuth, verifyIdentity } from "../aws/credentials";
import { loadConfig, saveConfig, type StoredConfig } from "../config";
import * as log from "../logger";

export interface LoginOptions extends CredentialOptions {
  save?: boolean;
}

export async function loginCommand(opts: LoginOptions): Promise<void> {
  let region = opts.region;
  const profile = opts.profile;
  let accessKeyId = opts.accessKeyId;
  let secretAccessKey = opts.secretAccessKey;
  let sessionToken = opts.sessionToken;

  const haveStaticFlags = Boolean(accessKeyId && secretAccessKey);
  const interactive = !profile && !haveStaticFlags && !process.env.AWS_ACCESS_KEY_ID;

  if (interactive) {
    const answers = await prompts(
      [
        {
          type: "text",
          name: "accessKeyId",
          message: "AWS Access Key ID",
          validate: (v: string) => (v.trim() ? true : "Access key ID is required"),
        },
        {
          type: "password",
          name: "secretAccessKey",
          message: "AWS Secret Access Key",
          validate: (v: string) => (v.trim() ? true : "Secret access key is required"),
        },
        {
          type: "text",
          name: "sessionToken",
          message: "AWS Session Token (optional, press Enter to skip)",
        },
        {
          type: "text",
          name: "region",
          message: "Default AWS Region",
          initial: region ?? loadConfig().region ?? "us-east-1",
        },
      ],
      {
        onCancel: () => {
          throw new Error("Login cancelled.");
        },
      },
    );
    accessKeyId = trimmedString(answers.accessKeyId);
    secretAccessKey = trimmedString(answers.secretAccessKey);
    sessionToken = trimmedString(answers.sessionToken);
    region = trimmedString(answers.region) ?? region;
  }

  const resolved = resolveAuth({ region, profile, accessKeyId, secretAccessKey, sessionToken });
  log.step(`Verifying credentials via STS (source: ${resolved.source})…`);
  const identity = await verifyIdentity(resolved);
  log.success(`Authenticated as ${identity.arn ?? identity.userId ?? "unknown principal"}`);
  log.info(`  Account: ${identity.account ?? "unknown"}`);
  log.info(`  Region:  ${resolved.region ?? "(none set)"}`);

  if (opts.save) {
    const config: StoredConfig = {};
    if (resolved.region) config.region = resolved.region;
    if (profile) {
      config.profile = profile;
    } else if (accessKeyId && secretAccessKey) {
      config.accessKeyId = accessKeyId;
      config.secretAccessKey = secretAccessKey;
      if (sessionToken) config.sessionToken = sessionToken;
    }
    const savedAt = saveConfig(config);
    log.success(`Saved configuration to ${savedAt} (file mode 0600).`);
    if (config.accessKeyId) {
      log.warn(
        "Secret key stored in plaintext. Prefer --profile or environment variables for long-lived credentials.",
      );
    }
  } else {
    log.info("Credentials verified but not saved. Re-run with --save to persist them.");
  }
}

/** Coerce a prompt answer (typed `any`) to a non-empty trimmed string or undefined. */
function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
