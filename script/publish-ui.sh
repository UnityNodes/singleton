#!/usr/bin/env bash
#
# Publishes ui/index.html to singleton.unitynodes.com.
#
# The site is one static file served by Caddy from /var/www/singleton, with a
# Cloudflare origin certificate and a content policy that allows the page to
# reach exactly one host: the Creditcoin RPC it reads the register from. There
# is no build step, because there is nothing to build.
#
#   ./script/publish-ui.sh

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${SINGLETON_WEBROOT:-/var/www/singleton}"

sudo mkdir -p "$target"
sudo cp "$root/ui/index.html" "$target/index.html"
sudo chown root:root "$target/index.html"

echo "published $(wc -c < "$root/ui/index.html") bytes to $target"
curl -s -o /dev/null -w "https://singleton.unitynodes.com/ -> %{http_code}\n" -m 20 https://singleton.unitynodes.com/
