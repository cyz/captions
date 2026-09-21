@description('Azure region for the container registry.')
param location string = resourceGroup().location

@description('Prefix used for resource tags.')
param namePrefix string = 'caption-burner'

var suffix = uniqueString(subscription().id, resourceGroup().id)
var registryName = 'acrcap${take(suffix, 13)}'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: {
    application: namePrefix
    costProfile: 'basic'
  }
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

output registryName string = registry.name
output loginServer string = registry.properties.loginServer