#!/usr/bin/env bash
# Usage unique : échange un code d'autorisation Strava contre un refresh_token permanent.
# N'écrit rien sur disque — le refresh_token n'est qu'affiché dans le terminal.
set -euo pipefail

CLIENT_ID="274097"

read -rsp "Client Secret Strava : " CLIENT_SECRET
echo
read -rp "Code d'autorisation : " AUTH_CODE

RESPONSE=$(curl -s -X POST https://www.strava.com/oauth/token \
  -d client_id="$CLIENT_ID" \
  -d client_secret="$CLIENT_SECRET" \
  -d code="$AUTH_CODE" \
  -d grant_type=authorization_code)

if command -v jq >/dev/null 2>&1; then
  REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.refresh_token // empty')
else
  REFRESH_TOKEN=$(echo "$RESPONSE" | grep -o '"refresh_token":"[^"]*"' | cut -d'"' -f4)
fi

if [ -z "$REFRESH_TOKEN" ]; then
  echo "Échec de l'échange. Réponse de Strava :"
  echo "$RESPONSE"
  exit 1
fi

echo
echo "Refresh token (copiez-le maintenant, il ne sera pas réaffiché) :"
echo "$REFRESH_TOKEN"
echo
echo "Déclarez-le ensuite sur le Worker avec :"
echo "  wrangler secret put REFRESH_TOKEN"
