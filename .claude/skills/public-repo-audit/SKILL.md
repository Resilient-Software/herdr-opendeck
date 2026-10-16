---
name: public-repo-audit
description: Use before any git add, commit, amend, push, tag, PR, release note or Marketplace listing text in this repository, and whenever asked to "commit everything", add docs/specs/plans, check in fixtures or screenshots from a real session, write README or marketing copy, or compare this plugin with other products. This repository is public open source.
---

# Public repo audit

This repository is public (Apache-2.0). Every tracked file, commit message,
PR body, tag and release note is published, and git history keeps it after a
later delete. Ask of every staged line: would the maintainer be happy to see
this on the public GitHub page today?

## Never publish

| Category | Examples | Do instead |
|---|---|---|
| Internal planning | anything under `docs/` (specs, plans, analysis), strategy, pricing, roadmap notes | Leave untracked. `docs/` is excluded locally via `.git/info/exclude`; never `git add -f` it |
| Other Stream Deck plugins and competing products | names, authors, links, prices, "unlike X", comparison tables | Describe this plugin's own features only |
| Personal and machine details | home paths (`/Users/<name>`), hostnames, Tailscale `*.ts.net` names, LAN IPs, personal or work emails, local usernames | Placeholders: `/home/dev/...`, `example.com` |
| Real session data | workspace labels, cwds, terminal titles, client or employer names captured from a real herdr session | Fictional data (`api-server`, `webapp`, `docs`) |
| Employer and customer context | company or customer names, internal tickets, chat links | Omit |
| Secrets | tokens, keys, `.env`, the installer's `herdr-path.txt` | Never stage |

## Before every commit

1. `git status --short`: stage named paths (`git add <path>...`). Use
   `git add -A` or `git add .` only when every untracked path is one you
   checked belongs in the public repo.
2. `sh .claude/skills/public-repo-audit/audit.sh`: scans the staged diff and
   paths. Where a local pre-commit hook runs it, never bypass the hook with
   `--no-verify`. Fix the finding, or tell the maintainer why it is a false
   positive.
3. Read `git diff --cached` yourself. The script matches patterns; it cannot
   judge copy or context.
4. Apply the same rules to the commit message, PR body and release notes
   (`audit.sh <message-file>` checks a message file).

"Commit everything" means everything that belongs in the public repo. Leave
internal files out and tell the maintainer exactly which ones and why.

Local extras: put case-sensitive extended regexes, one per line, in
`.git/info/public-denylist` (untracked) for names that must never appear,
such as competing products or private hostnames. Never copy that list into
a tracked file.

## Red flags

| Thought | Reality |
|---|---|
| "It's only a design doc" | `docs/` is internal. Untracked, always |
| "The maintainer said commit everything" | They meant everything publishable |
| "It's just a test fixture" | Fixtures are public; use fictional data |
| "A comparison helps users choose" | Never name other plugins; say what ours does |
| "I'll remove it in a follow-up commit" | History is public. Amend before pushing; if it was pushed, tell the maintainer at once |
