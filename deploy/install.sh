#!/usr/bin/env bash
set -euo pipefail

# Usage: sudo bash deploy/install.sh [port] [domain] [allowed-origin]
PORT="${1:-8080}"
DOMAIN="${2:-}"
ORIGINS="${3:-*}"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/little-server-speed-test"
if [[ "$EUID" -ne 0 ]]; then echo 'Run with sudo or as root.' >&2; exit 1; fi
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then echo 'Invalid port.' >&2; exit 1; fi
if [[ -n "$DOMAIN" && ! "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then echo 'Use a domain name without a scheme or port.' >&2; exit 1; fi
if [[ -n "$DOMAIN" && ( "$PORT" == 80 || "$PORT" == 443 ) ]]; then echo 'Choose a backend port other than 80 or 443 when using HTTPS.' >&2; exit 1; fi
if ! command -v docker >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y docker.io
    systemctl enable --now docker
  else
    echo 'Install Docker first, then run this script again. Automatic installation supports Debian/Ubuntu.' >&2; exit 1
  fi
fi
docker info >/dev/null
mkdir -p "$INSTALL_DIR"
if [[ "$SOURCE_DIR" != "$INSTALL_DIR" ]]; then
  cp -a "$SOURCE_DIR/server" "$SOURCE_DIR/public" "$SOURCE_DIR/deploy" "$SOURCE_DIR/Dockerfile" "$SOURCE_DIR/package.json" "$SOURCE_DIR/.dockerignore" "$INSTALL_DIR/"
fi
docker build -t little-server-speed-test:local "$INSTALL_DIR"
if [[ -n "$DOMAIN" ]]; then
  cat > "$INSTALL_DIR/Caddyfile" <<EOF
$DOMAIN {
  reverse_proxy speedtest:8080
}
EOF
  docker pull caddy:2-alpine
  docker network inspect little-speedtest >/dev/null 2>&1 || docker network create little-speedtest
fi
docker rm -f little-speedtest >/dev/null 2>&1 || true
if [[ -n "$DOMAIN" ]]; then
  docker run -d --name little-speedtest --restart unless-stopped --network little-speedtest --network-alias speedtest \
    -p "127.0.0.1:$PORT:8080" -e "ALLOWED_ORIGINS=$ORIGINS" --log-opt max-size=10m --log-opt max-file=2 little-server-speed-test:local
  docker rm -f little-speedtest-tls >/dev/null 2>&1 || true
  docker run -d --name little-speedtest-tls --restart unless-stopped --network little-speedtest \
    -p 80:80 -p 443:443 -v "$INSTALL_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" \
    -v little-speedtest-caddy-data:/data -v little-speedtest-caddy-config:/config \
    --log-opt max-size=10m --log-opt max-file=2 caddy:2-alpine
  echo "Ready: https://$DOMAIN (DNS must point here; allow/map TCP 80 and 443)."
else
  docker rm -f little-speedtest-tls >/dev/null 2>&1 || true
  docker run -d --name little-speedtest --restart unless-stopped -p "$PORT:8080" \
    -e "ALLOWED_ORIGINS=$ORIGINS" --log-opt max-size=10m --log-opt max-file=2 little-server-speed-test:local
  echo "Ready: http://YOUR_SERVER_IP:$PORT (allow/map TCP $PORT)."
fi
echo 'Logs: docker logs little-speedtest'
