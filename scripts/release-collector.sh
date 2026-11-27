#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
collector_dir="${COLLECTOR_CONTEXT:-../novr-collection}"
cd "$collector_dir"
git diff --quiet && git diff --cached --quiet || { echo 'Tracked collector changes need review.' >&2; exit 1; }

umask 077
identity_dir="$HOME/.ssh/novrcollector"
install -d -m 700 "$identity_dir"
identity="$identity_dir/github-read"
if [[ ! -f "$identity" ]]; then
  ssh-keygen -q -t ed25519 -N '' -C 'Pulse VPS collector read-only deployment' -f "$identity"
fi
known_hosts="$identity_dir/github-known-hosts"
printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$known_hosts"
printf -v GIT_SSH_COMMAND 'ssh -F /dev/null -i %q -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519 -o UserKnownHostsFile=%q' "$identity" "$known_hosts"
export GIT_SSH_COMMAND

if ! git fetch --no-tags git@github.com:novrGitLab/novrcollector.git refs/heads/main; then
  echo 'Register this public key as a read-only deploy key on novrGitLab/novrcollector and retry.' >&2
  printf 'Collector public key: '
  ssh-keygen -y -f "$identity"
  exit 1
fi
git merge-base --is-ancestor HEAD FETCH_HEAD || { echo 'Collector history has diverged. Review the checkout.' >&2; exit 1; }
git merge --ff-only FETCH_HEAD
docker compose up -d --build --wait --wait-timeout 120 collector
docker compose exec -T collector node -e "fetch('http://127.0.0.1:4100/healthz').then(r => { if (!r.ok) process.exitCode = 1 }).catch(() => { process.exitCode = 1 })"
printf 'Collector healthy at %s\n' "$(git rev-parse HEAD)"

