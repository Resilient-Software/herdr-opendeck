#!/bin/sh
# Audits what is about to become public: the staged diff and paths, plus an
# optional commit message file. With --all, scans every tracked file instead.
#
#   sh .claude/skills/public-repo-audit/audit.sh [--all] [commit-msg-file]
#
# Extra case-sensitive extended regexes, one per line, may be listed in the
# local, untracked file $(git rev-parse --git-path info/public-denylist).
set -eu

mode=staged
msg=""
for arg in "$@"; do
	case "$arg" in
		--all) mode=all ;;
		*) msg="$arg" ;;
	esac
done

patterns='/Users/[A-Za-z]
/home/[A-Za-z]
[A-Za-z0-9-]+\.ts\.net
\b10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b
\b192\.168\.[0-9]{1,3}\.[0-9]{1,3}\b
\b172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}\b
[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}
BEGIN [A-Z ]*PRIVATE KEY
\b(ghp|gho|ghs|github_pat|xox[abps]|sk-ant|sk-proj)[-_][A-Za-z0-9_-]{8,}
\bAKIA[0-9A-Z]{16}\b'

denylist="$(git rev-parse --git-path info/public-denylist)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '%s\n' "$patterns" > "$tmp/patterns"

status=0
report() {
	echo "public-repo-audit: $1" >&2
	status=1
}

if [ "$mode" = all ]; then
	git ls-files -z | xargs -0 grep -I -n -E -f "$tmp/patterns" -- > "$tmp/hits" 2>/dev/null || true
	if [ -s "$denylist" ]; then
		git ls-files -z | xargs -0 grep -I -n -E -f "$denylist" -- >> "$tmp/hits" 2>/dev/null || true
	fi
	paths="$(git ls-files)"
else
	git diff --cached -U0 --no-color | grep -E '^\+[^+]' > "$tmp/added" || true
	[ -n "$msg" ] && [ -f "$msg" ] && grep -v '^#' "$msg" >> "$tmp/added"
	grep -n -E -f "$tmp/patterns" "$tmp/added" > "$tmp/hits" || true
	if [ -s "$denylist" ]; then
		grep -n -E -f "$denylist" "$tmp/added" >> "$tmp/hits" || true
	fi
	paths="$(git diff --cached --name-only --diff-filter=ACR)"
fi

# Placeholder paths and addresses are fine.
sed -E 's#/home/(dev|user)/##g; s#[A-Za-z0-9._%+-]+@(example\.(com|org|net)|[A-Za-z0-9.-]+\.(invalid|test|example)|users\.noreply\.github\.com)##g' "$tmp/hits" |
	grep -E -f "$tmp/patterns" > "$tmp/real" || true
if [ -s "$denylist" ]; then
	grep -E -f "$denylist" "$tmp/hits" >> "$tmp/real" || true
fi
if [ -s "$tmp/real" ]; then
	report "possible private or third-party detail:"
	sed 's/^/  /' "$tmp/real" >&2
fi

internal="$(printf '%s\n' "$paths" | grep -E '^(docs/|\.env|.*herdr-path\.txt$|.*\.(pem|key)$)' || true)"
if [ -n "$internal" ]; then
	report "internal or secret paths would be published:"
	printf '%s\n' "$internal" | sed 's/^/  /' >&2
fi

[ "$status" -eq 0 ] && echo "public-repo-audit: clean"
exit "$status"
