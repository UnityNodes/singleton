#!/usr/bin/env bash
#
# Builds web/ and publishes it to singleton.unitynodes.com.
#
# The site is a static bundle served by Caddy from /var/www/singleton behind a
# Cloudflare origin certificate, with a content policy that lets the page reach
# the two Creditcoin RPCs and nothing else: the testnet one it reads by default,
# and the mainnet one so that `?rpc=` has somewhere to point.
#
#   ./script/publish-ui.sh

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${SINGLETON_WEBROOT:-/var/www/singleton}"

cd "$root/web"
npm run build

sudo mkdir -p "$target"
sudo rm -rf "$target"/assets
sudo cp -r dist/. "$target"/
sudo chown -R root:root "$target"

echo "published $(du -sh dist | cut -f1) to $target"
curl -s -o /dev/null -w "https://singleton.unitynodes.com/ -> %{http_code}\n" -m 20 https://singleton.unitynodes.com/
curl -s -o /dev/null -w "https://singleton.unitynodes.com/register -> %{http_code}\n" -m 20 https://singleton.unitynodes.com/register
