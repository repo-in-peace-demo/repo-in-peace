#!/usr/bin/env bash
# Regenerates the git log fixtures used by io/git-log-parse.test.ts.
#
#   git-log-sample.bin           raw output of the exact `git log` command the analyser runs
#   git-log-sample.expected.tsv  sha, parents, committer date (as git prints it), author per commit
#
# Commit dates, authors and file contents are fixed, so the SHAs are the same on every run.
# Run from anywhere: bash analyser/test/fixtures/make-git-log-sample.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_EMAIL=fixture@example.com GIT_COMMITTER_EMAIL=fixture@example.com

cd "$WORK"
git -c init.defaultBranch=main init -q .

# commit <message> <name> <date> [extra git commit args]
commit() {
  local msg="$1" name="$2" date="$3"
  shift 3
  GIT_AUTHOR_NAME="$name" GIT_COMMITTER_NAME="$name" \
    GIT_AUTHOR_DATE="$date" GIT_COMMITTER_DATE="$date" \
    git -c commit.gpgsign=false commit -q -m "$msg" "$@"
}

printf 'a\n' > a.ts
printf 'x\n' > "sp ace.ts"
mkdir -p src
printf 'u\n' > "src/é.ts"
git add -A
commit "one: add three files" "Ann Author" "2026-01-01T10:00:00+05:30"

printf 'a2\n' >> a.ts
git add -A
commit "two: modify a.ts" "Bob" "2026-01-02T10:00:00+00:00"

git mv a.ts b.ts
commit "three: rename a.ts to b.ts" "Ann Author" "2026-01-03T10:00:00-08:00"

git rm -q "sp ace.ts"
commit "four: delete sp ace.ts" "Bob" "2026-01-04T10:00:00+00:00"

git checkout -q -b side
printf 's\n' > side.ts
git add -A
commit "side: add side.ts" "Cy" "2026-01-05T10:00:00+00:00"

git checkout -q main
printf 'm\n' > main.ts
git add -A
commit "mainwork: add main.ts" "Di" "2026-01-06T10:00:00+00:00"

GIT_AUTHOR_NAME=Ed GIT_COMMITTER_NAME=Ed \
  GIT_AUTHOR_DATE="2026-01-07T10:00:00+00:00" GIT_COMMITTER_DATE="2026-01-07T10:00:00+00:00" \
  git -c commit.gpgsign=false merge -q --no-ff side -m "merge side"

commit "empty commit" "Fy" "2026-01-08T10:00:00+00:00" --allow-empty

# Keep in sync with GIT_LOG_ARGS in src/io/git-log-parse.ts.
git log --topo-order -z --name-status -M \
  --format='%x1e%H%x1f%P%x1f%cI%x1f%an' main > "$HERE/git-log-sample.bin"

git log --topo-order --format='%H%x09%P%x09%cI%x09%an' main > "$HERE/git-log-sample.expected.tsv"

echo "wrote $HERE/git-log-sample.bin and git-log-sample.expected.tsv"
