#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
readonly COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.prod.yml")

usage() {
  cat <<'EOF'
Usage: scripts/staging-deploy.sh COMMAND [ARG]

  check               Validate the host, environment, and Compose model
  backup [FILE]       Create a compressed PostgreSQL backup
  deploy COMMIT       Back up, check out an exact commit, build, migrate, and start

This script never provisions a server, DNS, credentials, or secrets. Run it from
a clean deployment clone. Restores remain an explicit manual operation because
they overwrite the database.
EOF
}

require_file() {
  [[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE; copy .env.production.example and fill it securely." >&2; exit 1; }
}

check() {
  require_file
  command -v docker >/dev/null || { echo 'docker is required' >&2; exit 1; }
  command -v git >/dev/null || { echo 'git is required' >&2; exit 1; }
  docker compose version >/dev/null
  "${COMPOSE[@]}" config --quiet
  [[ -z "$(git -C "$ROOT_DIR" status --porcelain)" ]] || { echo 'Deployment clone must be clean.' >&2; exit 1; }
}

backup() {
  require_file
  local destination="${1:-$ROOT_DIR/backups/postgres-$(date -u +%Y%m%dT%H%M%SZ).dump}"
  mkdir -p "$(dirname "$destination")"
  umask 077
  "${COMPOSE[@]}" exec -T postgres sh -c \
    'exec pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
    >"$destination"
  [[ -s "$destination" ]] || { rm -f "$destination"; echo 'Backup is empty.' >&2; exit 1; }
  echo "Backup written to $destination"
}

deploy() {
  local commit="${1:-}"
  [[ -n "$commit" ]] || { usage >&2; exit 2; }
  check
  git -C "$ROOT_DIR" cat-file -e "${commit}^{commit}"
  local resolved
  resolved="$(git -C "$ROOT_DIR" rev-parse "${commit}^{commit}")"

  if "${COMPOSE[@]}" ps --status running --quiet postgres | grep -q .; then
    backup
  else
    echo 'No running database detected; skipping the pre-deploy backup (first install only).'
  fi

  git -C "$ROOT_DIR" checkout --detach "$resolved"
  "${COMPOSE[@]}" build --pull
  "${COMPOSE[@]}" up -d --remove-orphans
  "${COMPOSE[@]}" ps
  echo "Deployed commit $resolved"
}

case "${1:-}" in
  check) check ;;
  backup) shift; backup "${1:-}" ;;
  deploy) shift; deploy "${1:-}" ;;
  *) usage >&2; exit 2 ;;
esac
