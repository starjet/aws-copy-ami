import { Command } from "commander";
import { loginCommand } from "./commands/login";
import { whoamiCommand } from "./commands/whoami";
import { logoutCommand } from "./commands/logout";
import { copyCommand } from "./commands/copy";

export const VERSION = "1.0.0";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("ami-to-s3")
    .description(
      "Copy a saved AWS AMI to S3, optionally gzip-compress it, and remove the uncompressed original.",
    )
    .version(VERSION);

  program
    .command("login")
    .description("Authenticate with an AWS IAM account and optionally save the credentials.")
    .option("-r, --region <region>", "AWS region")
    .option("-p, --profile <name>", "named AWS profile from ~/.aws/credentials")
    .option("--access-key-id <id>", "AWS access key ID (prefer interactive prompt or env vars)")
    .option("--secret-access-key <secret>", "AWS secret access key")
    .option("--session-token <token>", "AWS session token for temporary credentials")
    .option("--save", "persist the verified credentials/region to ~/.ami-to-s3/config.json", false)
    .action(loginCommand);

  program
    .command("whoami")
    .description("Print the STS caller identity for the resolved credentials.")
    .option("-r, --region <region>", "AWS region")
    .option("-p, --profile <name>", "named AWS profile")
    .action(whoamiCommand);

  program
    .command("logout")
    .description("Remove the saved configuration file (~/.ami-to-s3/config.json).")
    .action(logoutCommand);

  program
    .command("copy")
    .description(
      "Store an AMI into an S3 bucket (as <ami-id>.bin), then optionally gzip it and delete the original.",
    )
    .requiredOption("-i, --ami-id <id>", "AMI/image ID to copy (e.g. ami-0123456789abcdef0)")
    .requiredOption("-b, --bucket <name>", "destination S3 bucket (same region as the AMI)")
    .option("-r, --region <region>", "AWS region")
    .option("-p, --profile <name>", "named AWS profile")
    .option("--no-compress", "do not gzip the stored object")
    .option("--keep-original", "keep the uncompressed object after compressing", false)
    .option("--tags <pairs>", "comma-separated key=value S3 object tags for the stored object")
    .option("--poll-interval <seconds>", "seconds between store-task status checks", "15")
    .option("--timeout <seconds>", "max seconds to wait for the store task", "7200")
    .option("--gzip-level <1-9>", "gzip compression level (1 fastest, 9 smallest)", "6")
    .action(copyCommand);

  return program;
}
