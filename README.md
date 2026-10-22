# ami-to-s3

A small TypeScript/Node CLI that logs in with an **AWS IAM account** and copies a
saved **AMI** (Amazon Machine Image) into an **S3** bucket using the AWS SDK v3.
After the copy it can **gzip-compress** the stored object and **delete the
uncompressed original**.

## What it actually does

"Copy an AMI to S3" maps to the EC2 **Store/Restore AMI** feature:

1. `copy` calls EC2 [`CreateStoreImageTask`](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ami-store-restore.html),
   which writes the whole AMI into your bucket as a single object named
   **`<ami-id>.bin`**, then polls `DescribeStoreImageTasks` until it completes.
2. If compression is enabled (default), it streams `<ami-id>.bin` through gzip
   straight back into S3 as **`<ami-id>.bin.gz`** (a multipart streaming upload —
   nothing is written to local disk), then deletes the uncompressed
   `<ami-id>.bin`.

The stored object is restorable later with
[`CreateRestoreImageTask`](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ami-store-restore.html#restore-s3)
(see [Restoring the AMI](#restoring-the-ami)).

> Why `CreateStoreImageTask` and not `ExportImage`? `ExportImage` only works for
> VM-import-derived images and needs a `vmimport` service role. Store/Restore
> works for any EBS-backed AMI you own and is the canonical "AMI ⇄ S3" primitive.

## Requirements

- **Node.js ≥ 18** (built and tested on Node 20) and **Yarn** (classic/1.x is fine).
- An **AWS IAM** user or role with the permissions in
  [IAM permissions](#iam-permissions).
- A destination **S3 bucket in the same AWS Region as the AMI**.
- An **EBS-backed AMI you own** (Store/Restore does not support
  instance-store AMIs or images you only have launch permission on), within
  AWS's documented AMI-store size limits.

## Install & build

```bash
yarn install        # install dependencies
yarn build          # compile TypeScript to dist/
```

Run it in any of these ways:

```bash
node dist/index.js --help     # after build
yarn start --help             # same thing
yarn dev --help               # run from source via tsx (no build step)
```

Optionally expose it as a global `ami-to-s3` command:

```bash
yarn link           # or: npm i -g . (after yarn build)
ami-to-s3 --help
```

The examples below use `ami-to-s3`; substitute `node dist/index.js` or
`yarn dev` if you did not link it.

## Quick start

```bash
# 1. Log in with an IAM access key and save it locally
ami-to-s3 login --save

# 2. Copy an AMI to S3, compress it, and delete the uncompressed original
ami-to-s3 copy --ami-id ami-0123456789abcdef0 --bucket my-ami-backups --region us-east-1
```

On success the final S3 location is printed to **stdout** (everything else goes
to stderr, so it is safe to capture):

```
s3://my-ami-backups/ami-0123456789abcdef0.bin.gz
```

## Authentication (`login`)

`login` verifies credentials by calling STS `GetCallerIdentity` and, with
`--save`, persists them to `~/.ami-to-s3/config.json` (created `0700`, file
`0600`).

```bash
# Interactive: prompts for Access Key ID, Secret Access Key, optional
# Session Token, and a default Region.
ami-to-s3 login --save

# Use an existing named profile from ~/.aws/credentials instead of raw keys
ami-to-s3 login --profile my-profile --region us-east-1 --save

# Non-interactive with explicit keys (avoid on shared shells — visible in `ps`)
ami-to-s3 login \
  --access-key-id AKIA... --secret-access-key '...' \
  --region us-east-1 --save
```

Check who you are at any time:

```bash
ami-to-s3 whoami
# {
#   "account": "123456789012",
#   "arn": "arn:aws:iam::123456789012:user/backup",
#   "userId": "AIDA...",
#   "region": "us-east-1",
#   "credentialSource": "saved login keys"
# }
```

Remove the saved file:

```bash
ami-to-s3 logout
```

### Credential & region resolution

Every command resolves credentials in this order (first match wins):

1. `--access-key-id` + `--secret-access-key` (+ optional `--session-token`)
2. `--profile <name>`
3. Saved keys from `ami-to-s3 login --save`
4. Saved profile from `ami-to-s3 login --profile ... --save`
5. The **default AWS provider chain** (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
   env vars, shared config/credentials files, SSO, EC2/ECS instance roles, …)

Region is resolved as: `--region` → saved region → `AWS_REGION` →
`AWS_DEFAULT_REGION`.

> **Security note:** `--save` with raw keys writes the secret key in plaintext
> (mode `0600`). For long-lived use prefer `--profile`, environment variables,
> or short-lived credentials via `--session-token`.

## Copying an AMI (`copy`)

```bash
ami-to-s3 copy --ami-id <ami-id> --bucket <bucket> [options]
```

| Option | Default | Description |
| --- | --- | --- |
| `-i, --ami-id <id>` | — (required) | AMI/image ID, e.g. `ami-0123456789abcdef0`. |
| `-b, --bucket <name>` | — (required) | Destination bucket (same Region as the AMI). |
| `-r, --region <region>` | resolved | AWS region. |
| `-p, --profile <name>` | — | Named AWS profile. |
| `--no-compress` | compress on | Skip gzip; keep the raw `<ami-id>.bin`. |
| `--keep-original` | off | Keep `<ami-id>.bin` after creating `<ami-id>.bin.gz`. |
| `--tags <pairs>` | — | `key=value,key2=value2` S3 object tags for the stored object. |
| `--poll-interval <seconds>` | `15` | Seconds between store-task status checks. |
| `--timeout <seconds>` | `7200` | Max seconds to wait for the store task. |
| `--gzip-level <1-9>` | `6` | gzip level (1 fastest, 9 smallest). |

Examples:

```bash
# Default: store, gzip, delete the uncompressed original
ami-to-s3 copy -i ami-0123456789abcdef0 -b my-ami-backups -r us-east-1

# Keep both the raw and compressed objects, tag them, max compression
ami-to-s3 copy -i ami-0123456789abcdef0 -b my-ami-backups -r us-east-1 \
  --keep-original --gzip-level 9 --tags "team=infra,purpose=dr-backup"

# Just store the raw AMI, no compression
ami-to-s3 copy -i ami-0123456789abcdef0 -b my-ami-backups -r us-east-1 --no-compress

# Use a profile for this run only
ami-to-s3 copy -i ami-0123456789abcdef0 -b my-ami-backups -r us-east-1 -p my-profile
```

Example output:

```
→ Authenticating (source: saved login keys)…
✓ Authenticated as arn:aws:iam::123456789012:user/backup (account 123456789012).
→ Looking up AMI ami-0123456789abcdef0 in us-east-1…
  Name:  web-server-2026-10
  State: available
→ Starting store-image task to s3://my-ami-backups/ …
✓ Stored AMI to s3://my-ami-backups/ami-0123456789abcdef0.bin (task Completed).
→ Compressing s3://my-ami-backups/ami-0123456789abcdef0.bin with gzip (level 6)…
✓ Compressed → s3://my-ami-backups/ami-0123456789abcdef0.bin.gz
  Original:   8.00 GiB
  Compressed: 3.12 GiB (61.0% smaller)
✓ Removed uncompressed original s3://my-ami-backups/ami-0123456789abcdef0.bin.
s3://my-ami-backups/ami-0123456789abcdef0.bin.gz
```

## IAM permissions

Attach a policy like this to the IAM identity you log in with (replace
`YOUR_BUCKET`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StoreAmiToS3",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateStoreImageTask",
        "ec2:DescribeStoreImageTasks",
        "ec2:DescribeImages"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3Bucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET"
    },
    {
      "Sid": "S3Objects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
    }
  ]
}
```

`sts:GetCallerIdentity` (used by `login`/`whoami`) is allowed for any
authenticated principal and needs no explicit statement. `s3:DeleteObject` is
only exercised when the uncompressed original is removed (i.e. not with
`--keep-original` or `--no-compress`).

## Restoring the AMI

The stored object restores to a new AMI via EC2 `CreateRestoreImageTask`. If you
compressed it, decompress back to the raw `.bin` object first (restore expects
the raw store object):

```bash
# Decompress in place (adjust for your tooling)
aws s3 cp s3://my-ami-backups/ami-0123456789abcdef0.bin.gz - \
  | gunzip \
  | aws s3 cp - s3://my-ami-backups/ami-0123456789abcdef0.bin

# Restore to a new AMI
aws ec2 create-restore-image-task \
  --bucket my-ami-backups \
  --object-key ami-0123456789abcdef0.bin \
  --name "restored-web-server"
```

## Notes & caveats

- **Same-Region bucket.** `CreateStoreImageTask` requires the bucket to be in
  the same Region as the AMI; pass the matching `--region`.
- **Large images.** Stored AMIs can be many GB. The store task runs on the AWS
  side; raise `--timeout` for very large images. Compression streams through
  this process, so it needs network bandwidth but negligible local disk/RAM.
- **Costs.** You pay for S3 storage of the stored object plus request/transfer
  costs for the store task and the compression read/write.
- **Node version.** The AWS SDK v3 prints an advisory that releases after early
  2027 will require Node ≥ 22. Node 18/20 work today.

## Development

```bash
yarn dev <command>   # run from source (tsx), e.g. `yarn dev copy --help`
yarn build           # type-check + emit dist/
yarn typecheck       # type-check only
yarn test            # vitest unit tests (tag parsing, auth precedence, gzip round-trip)
```

### Project layout

```
src/
  index.ts            CLI entry (shebang)
  cli.ts              commander program + options
  config.ts           ~/.ami-to-s3/config.json load/save
  logger.ts           stderr status output / stdout results
  util.ts             tag parsing, byte formatting, int parsing
  aws/
    credentials.ts    credential/region precedence, STS verify
    storeImage.ts     CreateStoreImageTask + poll
    compress.ts       S3 → gzip → S3 streaming upload + delete
  commands/           login / whoami / logout / copy
test/                 vitest suites
```

## License

MIT
