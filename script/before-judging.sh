#!/usr/bin/env bash
#
# Everything that can go stale between finishing and being judged, in one run.
#
# The submission is not touched for days at a time and the world underneath it
# moves: the attestor set behind a source chain changes, a public RPC starts
# pruning, a web server restarts into a bad state, a certificate expires. None of
# that shows up in the repository, and all of it decides whether a judge opening
# the link sees the product or a spinner.
#
#   ./script/before-judging.sh
#
# Read only. It signs nothing, sends nothing and needs no key.

set -uo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 1

SITE="${SITE:-https://singleton.unitynodes.com}"
fail=0

step () {
  local name="$1"; shift
  local out
  if out=$("$@" 2>&1); then
    printf '  ok    %s\n' "$name"
  else
    printf '  FAIL  %s\n' "$name"
    printf '%s\n' "$out" | tail -10 | sed 's/^/          /'
    fail=$((fail + 1))
  fi
}

echo "the repository"
step "88 or more tests pass"        bash -c 'forge test'
step "every claim resolves"         bash -c 'node script/audit-claims.mjs'

echo "the chain"
step "configuration matches"        bash -c 'DEPLOYER_KEY_FILE=/dev/null node worker/provision.mjs --check'

# Status alone proves nothing here. The site is a single page app, so a path
# nobody defined still answers 200 with index.html, and a first version of this
# script passed every line while pointed at a nonsense prefix. Each target is
# checked for what it is: the routes for markup only the app serves, the PDFs for
# their magic bytes, the video for its ftyp box.
echo "what a judge opens"
served () {
  local url="$1" want="$2" bytes
  bytes=$(curl -s -m 30 "$url" | head -c 4096) || return 1
  printf '%s' "$bytes" | grep -qa -- "$want"
}
step "$SITE/ serves the app"          bash -c "$(declare -f served); served '$SITE/' '<div id=\"root\"'"
step "$SITE/register serves the app"  bash -c "$(declare -f served); served '$SITE/register' '<div id=\"root\"'"
step "$SITE/demo serves the app"      bash -c "$(declare -f served); served '$SITE/demo' '<div id=\"root\"'"
step "the deck is a PDF"              bash -c "$(declare -f served); served '$SITE/singleton-deck.pdf' '%PDF'"
step "the one pager is a PDF"         bash -c "$(declare -f served); served '$SITE/singleton-one-pager.pdf' '%PDF'"
step "the video is an mp4"            bash -c "$(declare -f served); served '$SITE/demo/singleton.mp4' 'ftyp'"

# The margin is not a pass or a fail, it is the number worth seeing before a
# judging window. The floor refuses below itself and not at it, so a chain sitting
# at the floor still records.
echo "the margin, for information"
DEPLOYER_KEY_FILE=/dev/null node worker/provision.mjs --check 2>/dev/null \
  | grep -E "minAttestors|deregistrations? would halt" | sed 's/^/  /'

echo
if [ "$fail" -eq 0 ]; then
  echo "nothing has moved under the submission"
  exit 0
fi
echo "$fail check$([ "$fail" -eq 1 ] || echo s) did not pass"
exit 1
