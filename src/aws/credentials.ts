import { fromIni } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { loadConfig, type StoredConfig } from "../config";

export interface CredentialOptions {
  region?: string;
  profile?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export type AuthMode = "static" | "profile" | "default";

export interface AuthPlan {
  region?: string;
  mode: AuthMode;
  profile?: string;
  static?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  source: string;
}

/**
 * Pure precedence resolver (no I/O) so it can be unit-tested. Credential
 * precedence: explicit CLI keys > CLI profile > saved keys > saved profile >
 * default AWS provider chain. Region precedence: CLI > saved > AWS_REGION >
 * AWS_DEFAULT_REGION.
 */
export function planAuth(
  opts: CredentialOptions,
  stored: StoredConfig,
  env: NodeJS.ProcessEnv,
): AuthPlan {
  const region = opts.region ?? stored.region ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION;

  if (opts.accessKeyId && opts.secretAccessKey) {
    return {
      region,
      mode: "static",
      static: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
        sessionToken: opts.sessionToken,
      },
      source: "command-line keys",
    };
  }
  if (opts.profile) {
    return { region, mode: "profile", profile: opts.profile, source: `profile "${opts.profile}"` };
  }
  if (stored.accessKeyId && stored.secretAccessKey) {
    return {
      region,
      mode: "static",
      static: {
        accessKeyId: stored.accessKeyId,
        secretAccessKey: stored.secretAccessKey,
        sessionToken: stored.sessionToken,
      },
      source: "saved login keys",
    };
  }
  if (stored.profile) {
    return {
      region,
      mode: "profile",
      profile: stored.profile,
      source: `saved profile "${stored.profile}"`,
    };
  }
  return { region, mode: "default", source: "default AWS provider chain" };
}

export interface ResolvedAuth {
  region?: string;
  credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider;
  source: string;
}

/** Resolve CLI options + saved config + env into a usable credential provider. */
export function resolveAuth(opts: CredentialOptions): ResolvedAuth {
  const plan = planAuth(opts, loadConfig(), process.env);
  if (plan.mode === "static" && plan.static) {
    return {
      region: plan.region,
      credentials: {
        accessKeyId: plan.static.accessKeyId,
        secretAccessKey: plan.static.secretAccessKey,
        sessionToken: plan.static.sessionToken,
      },
      source: plan.source,
    };
  }
  if (plan.mode === "profile" && plan.profile) {
    return { region: plan.region, credentials: fromIni({ profile: plan.profile }), source: plan.source };
  }
  return { region: plan.region, source: plan.source };
}

export interface ClientConfig {
  region?: string;
  credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider;
}

/** Shared client config builder; conditionally attaches region/credentials. */
export function clientConfig(auth: ResolvedAuth, fallbackRegion?: string): ClientConfig {
  const cfg: ClientConfig = {};
  const region = auth.region ?? fallbackRegion;
  if (region) cfg.region = region;
  if (auth.credentials) cfg.credentials = auth.credentials;
  return cfg;
}

export function requireRegion(auth: ResolvedAuth): string {
  if (!auth.region) {
    throw new Error(
      'No AWS region configured. Pass --region <region>, set AWS_REGION, or run "ami-to-s3 login --save --region <region>".',
    );
  }
  return auth.region;
}

export interface CallerIdentity {
  account?: string;
  arn?: string;
  userId?: string;
  region: string;
  source: string;
}

/** Confirm credentials work by calling STS GetCallerIdentity. */
export async function verifyIdentity(auth: ResolvedAuth): Promise<CallerIdentity> {
  const region = auth.region ?? "us-east-1";
  const sts = new STSClient(clientConfig(auth, "us-east-1"));
  try {
    const out = await sts.send(new GetCallerIdentityCommand({}));
    return { account: out.Account, arn: out.Arn, userId: out.UserId, region, source: auth.source };
  } finally {
    sts.destroy();
  }
}
