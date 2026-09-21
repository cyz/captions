#!/usr/bin/env bash
set -euo pipefail

readonly SUBSCRIPTION_ID="80714735-1a43-49a8-b34d-5d29fa8d63d9"
readonly TENANT_ID="5e76cd33-c0f8-4ebc-9413-cfe3e59074ad"
readonly RESOURCE_GROUP="caption-burner-rg"
readonly LOCATION="eastus2"
image_commit="$(git log -1 --format=%H -- Dockerfile package.json package-lock.json app lib worker next.config.js)"

command -v az >/dev/null

az account set --subscription "$SUBSCRIPTION_ID"
actual_tenant="$(az account show --query tenantId -o tsv)"
if [[ "$actual_tenant" != "$TENANT_ID" ]]; then
  printf 'Expected tenant %s, got %s\n' "$TENANT_ID" "$actual_tenant" >&2
  exit 1
fi

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

registry_name="$(az deployment group create \
  --name 'caption-registry' \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$(dirname "$0")/registry.bicep" \
  --query 'properties.outputs.registryName.value' \
  --output tsv)"

az acr build \
  --registry "$registry_name" \
  --image "captions:$image_commit" \
  --file Dockerfile \
  .

az deployment group create \
  --name 'caption-application' \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$(dirname "$0")/main.bicep" \
  --parameters \
    containerImage="${registry_name}.azurecr.io/captions:$image_commit" \
    registryName="$registry_name" \
  --query 'properties.outputs' \
  --output json