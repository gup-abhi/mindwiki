#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:?usage: smoke.sh BASE_URL}"
BASE_URL="${BASE_URL%/}"

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' 'jq is required' >&2
  exit 2
fi

suffix="$(openssl rand -hex 8)"
email="smoke-${suffix}@example.invalid"
password_hash="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
recovery_hash="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
device_id="smoke-${suffix}"
key_escrow='{"encrypted_key":"smoke-encrypted-key","salt":"smoke-salt"}'
recovery_escrow='{"encrypted_key":"smoke-recovery-key"}'

request() {
  local expected="$1"
  shift
  local body_file
  body_file="$(mktemp)"
  trap 'rm -f "$body_file"' RETURN
  local status
  status="$(curl --silent --show-error --output "$body_file" --write-out '%{http_code}' "$@")"
  if [[ "$status" != "$expected" ]]; then
    printf 'smoke request failed: expected HTTP %s, got %s\n' "$expected" "$status" >&2
    exit 1
  fi
  cat "$body_file"
}

health="$(request 200 "$BASE_URL/health")"
[[ "$(jq -r '.ok' <<<"$health")" == "true" ]]

register_body="$(request 200 -X POST "$BASE_URL/auth/register" -H 'Content-Type: application/json' -d "$(jq -cn --arg email "$email" --arg device "$device_id" --argjson key "$key_escrow" --argjson recovery "$recovery_escrow" '{email:$email,password_hash:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",key_escrow:$key,recovery_hash:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",recovery_escrow:$recovery,device_label:"staging smoke",platform:"ci",device_id:$device}')")"
account_id="$(jq -er '.account_id' <<<"$register_body")"
access_token="$(jq -er '.access_token' <<<"$register_body")"
refresh_token="$(jq -er '.refresh_token' <<<"$register_body")"

login_body="$(request 200 -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' -d "$(jq -cn --arg email "$email" --arg device "$device_id-login" '{email:$email,password_hash:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",device_label:"staging smoke login",platform:"ci",device_id:$device}')")"
login_access="$(jq -er '.access_token' <<<"$login_body")"
login_refresh="$(jq -er '.refresh_token' <<<"$login_body")"

refresh_body="$(request 200 -X POST "$BASE_URL/auth/refresh" -H 'Content-Type: application/json' -d "$(jq -cn --arg token "$refresh_token" '{refresh_token:$token}')")"
access_token="$(jq -er '.access_token' <<<"$refresh_body")"

sync_id="$(openssl rand -hex 32)"
updated_at="$(date +%s%3N)"
ciphertext="$(printf 'smoke-ciphertext-%s' "$suffix" | od -An -tx1 | tr -d ' \n')"
upload="$(jq -cn --arg ciphertext "$ciphertext" --arg sync_id "$sync_id" --argjson updated_at "$updated_at" '{version:2,table:"entries",sync_id:$sync_id,ciphertext:$ciphertext,updated_at:$updated_at}')"
request 200 -X PUT "$BASE_URL/sync/$account_id/v2/entries/$sync_id" -H "Authorization: Bearer $access_token" -H 'Content-Type: application/json' -d "$upload" >/dev/null

delta="$(request 200 "$BASE_URL/sync/$account_id/delta?since=0" -H "Authorization: Bearer $access_token")"
[[ "$(jq -r '.records | length' <<<"$delta")" -ge 1 ]]

audit="$(request 200 "$BASE_URL/sync/$account_id/audit?dry_run=true&all=true" -H "Authorization: Bearer $access_token")"
[[ "$(jq -r '.dry_run' <<<"$audit")" == "true" ]]

request 204 -X POST "$BASE_URL/auth/logout" -H "Authorization: Bearer $login_access" >/dev/null
request 204 -X DELETE "$BASE_URL/auth/account" -H "Authorization: Bearer $access_token" >/dev/null

printf '%s\n' 'server smoke checks passed'
