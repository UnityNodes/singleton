#!/usr/bin/env bash
#
# Builds and checks this repository from a fresh clone of itself.
#
# Written after the same fault appeared twice: deck/build.py imported its fonts
# from a module in /tmp, and script/record-demo.mjs imported a browser from a
# different project's node_modules. Both worked perfectly here and on no other
# machine, and nothing in the repository could tell, because everything that ran
# ran in a working directory that already had what was missing.
#
# So this clones into a temporary directory and runs the whole thing there. What
# it cannot find, it does not have.
#
#   ./script/from-a-clone.sh
#
# It needs network: git for the submodule, npm for two installs, and the live
# chain for the last step. It changes nothing on chain and needs no key.

set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail=0
step () {
  local name="$1"; shift
  local out
  if out=$("$@" 2>&1); then
    printf '  ok    %s\n' "$name"
  else
    printf '  FAIL  %s\n' "$name"
    printf '%s\n' "$out" | tail -12 | sed 's/^/          /'
    fail=$((fail + 1))
  fi
}

# A clone on the same machine as the original still resolves an absolute path
# into the original, so cloning alone cannot see this class. It is the reason
# the mutation that reintroduced one passed every step below. Read the source
# instead: nothing tracked here should name a directory on somebody's machine.
echo "reading the source for paths that only exist on one machine"
machine_paths=$(
  git -C "$root" ls-files '*.mjs' '*.py' '*.sh' '*.ts' '*.tsx' '*.sol' '*.json' \
    | grep -v node_modules \
    | (cd "$root" && xargs grep -nE '"(/root|/home|/Users|/tmp)[^"]*"|'"'"'(/root|/home|/Users|/tmp)[^'"'"']*'"'"'' 2>/dev/null) \
    | grep -v '^script/from-a-clone.sh:'
)
if [ -n "$machine_paths" ]; then
  echo "  FAIL  a tracked file names a path on this machine"
  printf '%s\n' "$machine_paths" | sed 's/^/          /'
  fail=$((fail + 1))
else
  echo "  ok    no tracked file names a path on this machine"
fi

echo "cloning $root into $work"
if ! git clone -q --recurse-submodules "$root" "$work/singleton" 2>/dev/null; then
  echo "  FAIL  clone"
  exit 1
fi
cd "$work/singleton" || exit 1
echo "checking what a clone can do with no help from the machine it was cloned on"

step "forge test"                 bash -c 'forge test'
step "deck/build.py"              bash -c 'python3 deck/build.py'
step "script/audit-claims.mjs"    bash -c 'node script/audit-claims.mjs'
step "web: npm ci and build"      bash -c 'cd web && npm ci --silent && npm run build'
step "worker: npm ci"             bash -c 'cd worker && npm ci --silent'
step "worker/provision.mjs --check" bash -c 'DEPLOYER_KEY_FILE=/dev/null node worker/provision.mjs --check'

# The gates are the probes that cleared the technical unknowns before any of
# this was built, and README offers them as something a judge can re-run. They
# were not: one imported a file that was never committed, both read their
# artifact as a bare filename out of whatever directory somebody was standing
# in, and neither had a package.json. That went unnoticed from the first commit
# because nothing here ever ran them.
step "gates: build the probes"    bash -c 'FOUNDRY_PROFILE=gates forge build'
step "gates: npm ci"              bash -c 'cd gates && npm ci --silent'
step "gates: finality, live"      bash -c 'cd gates && node run/gate-finality.mjs'
step "gates: custom event, live"  bash -c 'cd gates && node run/gate-custom-event.mjs | grep -q "GATE: PASS"'

echo
if [ "$fail" -eq 0 ]; then
  echo "a clone builds, tests, audits and reads the live chain with nothing borrowed"
  exit 0
fi
echo "$fail step$([ "$fail" -eq 1 ] || echo s) a clone cannot complete"
exit 1
