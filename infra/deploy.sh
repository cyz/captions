#!/usr/bin/env bash
set -euo pipefail

readonly SUBSCRIPTION_ID="80714735-1a43-49a8-b34d-5d29fa8d63d9"
readonly TENANT_ID="5e76cd33-c0f8-4ebc-9413-cfe3e59074ad"
readonly RESOURCE_GROUP="caption-burner-rg"
readonly LOCATION="eastus2"
image_commit="$(git log -1 --format=%H -- Dockerfile package.json package-lock.json app lib worker next.config.js)"
readonly IMAGE="ghcr.io/cyz/captions:sha-${image_commit}"

command -v az >/dev/null

az account set --subscription "$SUBSCRIPTION_ID"
actual_tenant="$(az account show --query tenantId -o tsv)"
if [[ "$actual_tenant" != "$TENANT_ID" ]]; then
  printf 'Expected tenant %s, got %s\n' "$TENANT_ID" "$actual_tenant" >&2
  exit 1
fi

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  registry_token="$(gh auth token)"
else
  credential_payload="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill)"
  registry_token="$(printf '%s\n' "$credential_payload" | sed -n 's/^password=//p')"
  unset credential_payload
fi
if [[ -z "$registry_token" ]]; then
  printf 'No GitHub credential is available for the private container image.\n' >&2
  exit 1
fi
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$(dirname "$0")/main.bicep" \
  --parameters \
    containerImage="$IMAGE" \
    registryUsername="cyz" \
    registryPassword="$registry_token" \
  --query 'properties.outputs' \
  --output json

unset registry_token