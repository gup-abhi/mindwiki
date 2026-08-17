#!/usr/bin/env bash
set -euo pipefail

environment="${1:?usage: verify-deploy-config.sh staging|production}"
case "$environment" in
  staging|production) ;;
  *) printf 'unknown environment: %s\n' "$environment" >&2; exit 2 ;;
esac

config="$(cd "$(dirname "$0")/.." && pwd)/wrangler.toml"
case "$environment" in
  staging) resource_patterns=('00000000000000000000000000000000' 'mindwiki-staging-placeholder') ;;
  production) resource_patterns=('11111111111111111111111111111111' 'mindwiki-production-placeholder') ;;
esac

for resource_pattern in "${resource_patterns[@]}"; do
if grep -q "$resource_pattern" "$config"; then
  printf '%s Cloudflare resource identifiers are not provisioned\n' "$environment" >&2
  exit 1
fi
done

printf '%s deployment configuration is provisioned\n' "$environment"
