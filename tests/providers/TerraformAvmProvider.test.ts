import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerraformAvmProvider } from '../../providers/TerraformAvmProvider.js';

function createResponse(text: string, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => text
  } as any;
}

describe('TerraformAvmProvider', () => {
  const provider = new TerraformAvmProvider();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes only Available modules (filters out Proposed, Orphaned)', async () => {
    const header = 'ProviderNamespace,ResourceType,ModuleDisplayName,AlternativeNames,ModuleName,ParentModule,ModuleStatus,RepoURL,PublicRegistryReference,TelemetryIdPrefix,PrimaryModuleOwnerGHHandle,PrimaryModuleOwnerDisplayName,SecondaryModuleOwnerGHHandle,SecondaryModuleOwnerDisplayName,ModuleOwnersGHTeam,ModuleContributorsGHTeam,Description,Comments,FirstPublishedIn';
    const proposed = 'Microsoft.AAD,domainServices,Azure Active Directory Domain Service,,avm-res-aad-domainservice,n/a,Proposed,https://github.com/Azure/terraform-azurerm-avm-res-aad-domainservice,https://registry.terraform.io/modules/Azure/avm-res-aad-domainservice/azurerm/latest,46d3xgtf.res.aad-domainservice,humanascode,Itamar Hirosh,,,,@Azure/avm-res-aad-domainservice-module-owners-tf,@Azure/avm-res-aad-domainservice-module-contributors-tf,AVM Resource Module for Azure Active Directory Domain Service,,';
    const orphaned = 'Microsoft.Network,publicIPAddresses,Public IP Address,PIP,avm-res-network-publicipaddress,n/a,Orphaned,https://github.com/Azure/terraform-azurerm-avm-res-network-publicipaddress,https://registry.terraform.io/modules/Azure/avm-res-network-publicipaddress/azurerm/latest,46d3xgtf.res.network-publicip,,,,,@Azure/avm-res-network-publicipaddress-module-owners-tf,@Azure/avm-res-network-publicipaddress-module-contributors-tf,AVM Resource Module for Public IP Address,,2024-02';
    const available = 'Microsoft.App,containerApps,Container App,,avm-res-app-containerapp,n/a,Available,https://github.com/Azure/terraform-azurerm-avm-res-app-containerapp,https://registry.terraform.io/modules/Azure/avm-res-app-containerapp/azurerm/latest,46d3xgtf.res.app-containerapp,lonegunmanb,Zijie He,,,,@Azure/avm-res-app-containerapp-module-owners-tf,@Azure/avm-res-app-containerapp-module-contributors-tf,AVM Resource Module for Container App,,2024-07';
    const csv = `${header}\n${proposed}\n${orphaned}\n${available}`;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('TerraformResourceModules.csv')) {
        return createResponse(csv);
      }
      if (url.endsWith('/README.md')) {
        return createResponse('# Readme');
      }
      return createResponse('', false, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    const modules = await provider.loadAllModules();
    expect(modules.length).toBe(1);
    expect(modules[0].moduleStatus).toBe('Available');
    expect(modules[0].moduleName).toBe('avm-res-app-containerapp');
  });

  it('prefers Terraform Registry doc URL over repo README', async () => {
    const header = 'ProviderNamespace,ResourceType,ModuleDisplayName,AlternativeNames,ModuleName,ParentModule,ModuleStatus,RepoURL,PublicRegistryReference,TelemetryIdPrefix,PrimaryModuleOwnerGHHandle,PrimaryModuleOwnerDisplayName,SecondaryModuleOwnerGHHandle,SecondaryModuleOwnerDisplayName,ModuleOwnersGHTeam,ModuleContributorsGHTeam,Description,Comments,FirstPublishedIn';
    const available = 'Microsoft.Storage,storageAccounts,Storage Account,,avm-res-storage-storageaccount,n/a,Available,https://github.com/Azure/terraform-azurerm-avm-res-storage-storageaccount,https://registry.terraform.io/modules/Azure/avm-res-storage-storageaccount/azurerm/latest,46d3xgtf.res.storage-storageaccount,chinthakaru,Chinthaka Rupasinghe,,,,@Azure/avm-res-storage-storageaccount-module-owners-tf,@Azure/avm-res-storage-storageaccount-module-contributors-tf,AVM Resource Module for Storage Account,,2024-02';
    const csv = `${header}\n${available}`;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('TerraformResourceModules.csv')) {
        return createResponse(csv);
      }
      if (url.endsWith('/README.md')) {
        return createResponse('# Readme');
      }
      return createResponse('', false, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    const modules = await provider.loadAllModules();
    const docUrl = provider.getDocumentationUrl(modules[0]);
    expect(docUrl).toMatch(/^https:\/\/registry\.terraform\.io\/modules\//);
  });
}); 