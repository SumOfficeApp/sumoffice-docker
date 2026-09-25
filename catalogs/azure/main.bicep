// SumOffice — Azure Application (solution template): one Ubuntu 24.04 LTS VM that runs the SumOffice stack
// for Nextcloud (SumSheet /f1, SumDoc /a4, WOPI discovery /hosting/*) behind Caddy with a Let's Encrypt
// certificate for the VM's Azure DNS name (or a DNS name of your own).
//
// Source of mainTemplate.json:  bicep build main.bicep --outfile mainTemplate.json
// cloud-init.yaml is embedded at build time (loadTextContent), so the package needs only the two JSON files.

@description('Location for all resources.')
param location string = resourceGroup().location

@description('Name of the virtual machine.')
@minLength(1)
@maxLength(64)
param vmName string = 'sumoffice'

@description('Size of the virtual machine. 2 GB RAM for the server plus about 250 MB per open document.')
param vmSize string = 'Standard_B2s'

@description('Administrator user name for SSH.')
param adminUsername string

@description('Type of authentication for the administrator.')
@allowed([
  'sshPublicKey'
  'password'
])
param authenticationType string = 'sshPublicKey'

@description('SSH public key or password for the administrator, depending on authenticationType.')
@secure()
param adminPasswordOrKey string

@description('Address of the Nextcloud your users open, e.g. https://cloud.example.com (the WOPI host allowed to open files).')
param nextcloudUrl string

@description('Optional DNS name of your own (A/CNAME record pointing at the VM). Use "none" to publish at the Azure DNS name of the public IP address.')
param customDomain string = 'none'

@description('Source address prefix allowed to reach SSH (port 22), e.g. your office range in CIDR form, or * for any.')
param sshSourceAddressPrefix string = '*'

@description('Branch or tag of github.com/SumOfficeApp/sumoffice-docker that the VM installs from.')
param sumofficeRef string = 'main'

var dnsLabel = toLower('sumoffice-${uniqueString(resourceGroup().id, vmName)}')
var nsgName = '${vmName}-nsg'
var vnetName = '${vmName}-vnet'
var subnetName = 'default'
var publicIpName = '${vmName}-ip'
var nicName = '${vmName}-nic'

var linuxConfiguration = {
  disablePasswordAuthentication: true
  ssh: {
    publicKeys: [
      {
        path: '/home/${adminUsername}/.ssh/authorized_keys'
        keyData: adminPasswordOrKey
      }
    ]
  }
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2025-05-01' = {
  name: nsgName
  location: location
  properties: {
    securityRules: [
      {
        name: 'SSH'
        properties: {
          priority: 1000
          protocol: 'Tcp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: sshSourceAddressPrefix
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
        }
      }
      {
        name: 'HTTP'
        properties: {
          priority: 1010
          protocol: 'Tcp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '80'
        }
      }
      {
        name: 'HTTPS'
        properties: {
          priority: 1020
          protocol: 'Tcp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2025-05-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.10.0.0/16'
      ]
    }
    subnets: [
      {
        name: subnetName
        properties: {
          addressPrefix: '10.10.0.0/24'
          networkSecurityGroup: {
            id: nsg.id
          }
        }
      }
    ]
  }
}

resource publicIp 'Microsoft.Network/publicIPAddresses@2025-05-01' = {
  name: publicIpName
  location: location
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: {
      domainNameLabel: dnsLabel
    }
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2025-05-01' = {
  name: nicName
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: {
            id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, subnetName)
          }
          publicIPAddress: {
            id: publicIp.id
          }
        }
      }
    ]
  }
}

var siteDomain = (empty(customDomain) || toLower(customDomain) == 'none') ? publicIp.properties.dnsSettings.fqdn : customDomain
var cloudInit = replace(
  replace(replace(loadTextContent('cloud-init.yaml'), '__SUMOFFICE_REF__', sumofficeRef), '__DOMAIN__', siteDomain),
  '__NEXTCLOUD_URL__',
  nextcloudUrl
)

resource vm 'Microsoft.Compute/virtualMachines@2025-04-01' = {
  name: vmName
  location: location
  properties: {
    hardwareProfile: {
      vmSize: vmSize
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        diskSizeGB: 30
        managedDisk: {
          storageAccountType: 'StandardSSD_LRS'
        }
      }
    }
    osProfile: {
      computerName: vmName
      adminUsername: adminUsername
      adminPassword: adminPasswordOrKey
      linuxConfiguration: ((authenticationType == 'password') ? null : linuxConfiguration)
      customData: base64(cloudInit)
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
        }
      ]
    }
  }
}

output editorsUrl string = 'https://${siteDomain}'
output azureDnsName string = publicIp.properties.dnsSettings.fqdn
output sshCommand string = 'ssh ${adminUsername}@${publicIp.properties.dnsSettings.fqdn}'
output nextcloudCommand string = 'sh nextcloud-occ.sh https://${siteDomain}'
