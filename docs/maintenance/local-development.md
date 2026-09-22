# Local development and Git synchronization

The tracked repository is the portable application core. A real deployment is
that core plus ignored local inputs:

```text
tracked source + .local deployment overlay + local secrets/assets = deployment
```

Git does not upload, merge, delete, or replace ignored `.env` and `.local/`
files during normal fetch, rebase, pull, or push operations.

## Classify each change

Commit changes that improve the reusable project: application code, tests,
container definitions, safe configuration examples, generated project
artwork, scripts, and documentation.

Keep deployment-specific values local: real hostnames and addresses,
certificates, credentials, Authentik tokens, SMTP settings, TrueNAS paths,
licensed audio files, active scene state, and database content.

If a fix is first made in an older deployment workspace, port the smallest
logical change into this repository. Do not copy a running container or its
complete production configuration over the canonical source tree.

## Recommended branch workflow

Start from an up-to-date `main` branch:

```sh
git switch main
git pull --ff-only origin main
git switch -c feature/short-description
```

Make and test the change with your local overlay, then commit it:

```sh
./scripts/test.sh
git add path/to/changed-source path/to/tests
git commit -m "Describe the improvement"
```

The sync helper refuses dirty or detached worktrees, rebases the current branch
onto `origin/main`, reruns tests, and performs a normal non-force push:

```sh
./scripts/sync-branch.sh
```

Open a pull request on GitHub and merge only after CI passes. Then refresh the
local main branch with `git switch main && git pull --ff-only origin main`.

## Local deployment overlay

Suggested ignored paths are:

```text
.env
.local/audio-source/
.local/deploy/truenas/
.local/secrets/
.local/tls/
.local/data/
```

Use `./scripts/import-audio.sh .local/audio-source` after a clean clone to
install and verify the optional soundtrack. The imported MP3 files remain
ignored. A local Compose override can mount `.local/deploy/truenas/nginx.conf`
and protected certificate/secret paths without changing tracked files.

Before committing, use `git status --short`. Expected local-only inputs should
not appear. Never use `git add -f` to force ignored deployment files into Git.

## Updating production

Pushing source to GitHub does not deploy it. Pull, build, acceptance-test, and
cut over production through a separately reviewed procedure with backup,
rollback, and active-session gates.
