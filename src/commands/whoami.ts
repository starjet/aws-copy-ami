import type { CredentialOptions } from "../aws/credentials";
import { resolveAuth, verifyIdentity } from "../aws/credentials";
import * as log from "../logger";

export async function whoamiCommand(opts: CredentialOptions): Promise<void> {
  const resolved = resolveAuth(opts);
  const identity = await verifyIdentity(resolved);
  log.result(
    JSON.stringify(
      {
        account: identity.account ?? null,
        arn: identity.arn ?? null,
        userId: identity.userId ?? null,
        region: resolved.region ?? null,
        credentialSource: resolved.source,
      },
      null,
      2,
    ),
  );
}
