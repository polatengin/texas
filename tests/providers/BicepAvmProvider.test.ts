import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BicepAvmProvider } from '../../providers/BicepAvmProvider.js';

function createResponse(text: string, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => text
  } as any;
}

describe('BicepAvmProvider', () => {
  const provider = new BicepAvmProvider();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters out Proposed modules from CSV', async () => {
    const csvHeader = [
      'ProviderNamespace','ResourceType','ModuleDisplayName','AlternativeNames','ModuleName','ParentModule','ModuleStatus','RepoURL','PublicRegistryReference',
      'col9','col10','col11','col12','col13','col14','col15','Description'
    ].join(',');
    const proposedRow = [
      'Microsoft.Storage','storageAccounts','Storage Account','','storage/storage-account','','Proposed','https://example.com/repo','br/public:storage/storage-account',
      '','','','','','','','Storage account module'
    ].join(',');
    const csv = `${csvHeader}\n${proposedRow}`;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('BicepResourceModules.csv')) {
        return createResponse(csv);
      }
      return createResponse('', false, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    const modules = await provider.loadAllModules();
    expect(modules.length).toBe(0);
  });

  it('loads available modules and parses README metadata', async () => {
    const csvHeader = [
      'ProviderNamespace','ResourceType','ModuleDisplayName','AlternativeNames','ModuleName','ParentModule','ModuleStatus','RepoURL','PublicRegistryReference',
      'col9','col10','col11','col12','col13','col14','col15','Description'
    ].join(',');
    const availableRow = [
      'Microsoft.Storage','storageAccounts','Storage Account','SA','storage/storage-account','','Available','https://example.com/repo','br/public:storage/storage-account',
      '','','','','','','','Storage account module'
    ].join(',');
    const csv = `${csvHeader}\n${availableRow}`;

    const readme = `# Storage Account\n\nSome description here. br/public:storage/storage-account/some:1.0\n\n## Parameters\n\n| Name | Type | Required | Default Value | Description |\n| --- | --- | --- | --- | --- |\n| name | string | Yes |  | Resource name |\n\n## Resource Types\n\n| Resource Type | API Version |\n| --- | --- |\n| Microsoft.Storage/storageAccounts | 2023-01-01 |\n`;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('BicepResourceModules.csv')) {
        return createResponse(csv);
      }
      if (url.endsWith('/README.md')) {
        return createResponse(readme);
      }
      return createResponse('', false, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    const modules = await provider.loadAllModules();
    expect(modules.length).toBe(1);

    const mod = modules[0];
    expect(mod.moduleName).toBe('storage/storage-account');
    expect(mod.providerNamespace).toBe('Microsoft.Storage');
    expect(mod.resourceType).toBe('storageAccounts');
    expect(mod.parsedMarkdown).toBeDefined();
    expect(mod.parsedMarkdown?.brEndpoint).toContain('br/public:');
    expect(mod.parsedMarkdown?.resourceTypes?.[0]?.type).toBe('Microsoft.Storage/storageAccounts');
    expect(mod.parsedMarkdown?.resourceTypes?.[0]?.apiVersion).toBe('2023-01-01');

    const docUrl = provider.getDocumentationUrl(mod);
    expect(docUrl).toMatch(/bicep-registry-modules\/tree\/main\/storage\/storage-account$/);
  });
}); 