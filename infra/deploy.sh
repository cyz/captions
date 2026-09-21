#!/usr/bin/env bash
set -euo pipefail

readonly SUBSCRIPTION_ID="80714735-1a43-49a8-b34d-5d29fa8d63d9"
readonly TENANT_ID="5e76cd33-c0f8-4ebc-9413-cfe3e59074ad"
readonly RESOURCE_GROUP="caption-burner-rg"
readonly LOCATION="eastus2"
readonly IMAGE="ghcr.io/cyz/captions:latest"

command -v az >/dev/null
command -v gh >/dev/null

az account set --subscription "$SUBSCRIPTION_ID"
actual_tenant="$(az account show --query tenantId -o tsv)"
if [[ "$actual_tenant" != "$TENANT_ID" ]]; then
  printf 'Expected tenant %s, got %s\n' "$TENANT_ID" "$actual_tenant" >&2
  exit 1
fi

registry_token="$(gh auth token)"
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