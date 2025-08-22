#!/usr/bin/env node

import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BicepAvmProvider } from "./providers/BicepAvmProvider.js";
import { TerraformAvmProvider } from "./providers/TerraformAvmProvider.js";
import type { AVMModule } from "./types.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION
});

const bicepProvider = new BicepAvmProvider();
const terraformProvider = new TerraformAvmProvider();

server.registerResource(
  "list_avm_bicep_modules",
  "resource://list_avm_bicep_modules",
  {
    title: "List All Bicep AVM Modules",
    description: "List all Bicep AVM Modules that have documentation",
  },
  async () => {
    return {
      contents: (await bicepProvider.loadAllModules()).map((module: AVMModule) => ({
        uri: `resource://get_avm_module_details/bicep/${module.moduleName}`,
        text: `${module.moduleDisplayName} (Bicep)`
      }))
    };
  }
);

server.registerResource(
  "list_avm_terraform_modules",
  "resource://list_avm_terraform_modules",
  {
    title: "List All Terraform AVM Modules",
    description: "List all Terraform AVM Modules that have documentation",
  },
  async () => {
    return {
      contents: (await terraformProvider.loadAllModules()).map((module: AVMModule) => ({
        uri: `resource://get_avm_module_details/terraform/${module.moduleName}`,
        text: `${module.moduleDisplayName} (Terraform)`
      }))
    };
  }
);

server.registerResource(
  "get_avm_module_details",
  new ResourceTemplate("resource://get_avm_module_details/{providerName}/{moduleName}", { list: undefined }),
  {
    title: "Get AVM Module Details",
    description: "Get detailed information about a specific AVM module",
  },
  async (_, variables) => {
    const moduleName = Array.isArray(variables.moduleName) ? variables.moduleName[0] : (variables.moduleName || '');
    const providerName = Array.isArray(variables.providerName) ? variables.providerName[0] : (variables.providerName || '');

    const provider = providerName === 'terraform' ? terraformProvider : bicepProvider;

    const module = await provider.getModuleByName(moduleName);

    if (!module) {
      return {
        contents: [{
          uri: `resource://get_avm_module_details/${providerName}/${moduleName}`,
          text: `Module not found: ${moduleName}`
        }]
      };
    }

    const avmDetails = {
      resourceType: module.parsedMarkdown?.resourceTypes?.[0]?.type || module.resourceType || 'Not found',
      apiVersion: module.parsedMarkdown?.resourceTypes?.[0]?.apiVersion || 'Not found',
      brEndpoint: module.parsedMarkdown?.brEndpoint || 'Not found',
      url: provider.getDocumentationUrl(module)
    };

    const detailsText = `# ${module.moduleDisplayName}

      **Provider Namespace:** ${module.providerNamespace}
      **Resource Type:** ${module.resourceType}
      **Module Name:** ${module.moduleName}
      **Status:** ${module.moduleStatus}
      **Alternative Names:** ${module.alternativeNames}

      ## Module Information
      - **Parent Module:** ${module.parentModule}
      - **Repository URL:** ${module.repoURL}
      - **Registry Reference:** ${module.publicRegistryReference}

      ## Parsed Details
      - **Resource Type:** ${avmDetails.resourceType || 'Not found'}
      - **API Version:** ${avmDetails.apiVersion || 'Not found'}
      - **BR Endpoint:** ${avmDetails.brEndpoint || 'Not found'}
      - **Documentation URL:** ${avmDetails.url}

      ## Description
      ${module.description}

      ## Documentation
      ${module.markdown}`;

    return {
      contents: [{
        uri: `resource://get_avm_module_details/${module.moduleName}`,
        text: detailsText
      }]
    };
  }
);

server.registerTool(
  "mcp_find_avm_modules",
  {
    title: "Find AVM Modules",
    description: "Find AVM modules based on resource types with optional provider filtering",
    inputSchema: {
      resources: z.array(z.string()).describe("A list of desired Azure resource types (e.g., 'storage account', 'web app')."),
      provider: z.enum(['bicep', 'terraform']).optional().default('bicep').describe("Filter by provider type: 'terraform' or 'bicep' (default)")
    }
  },
  async (args: { resources: string[]; provider?: 'bicep' | 'terraform' }) => {
    const isTerraform = args.provider === 'terraform';
    const provider = isTerraform ? terraformProvider : bicepProvider;
    const filteredModules = await provider.loadAllModules();

    const result: Record<string, { doc_name: string; resource_type: string | null; api_version: string | null; br_endpoint: string | null; provider_type: string; found: boolean }> = {};
    for (const requestedResource of args.resources) {
      const bestMatchModule = filteredModules.find((module: AVMModule) =>
        module.moduleDisplayName.toLowerCase().includes(requestedResource.toLowerCase()) ||
        module.alternativeNames.toLowerCase().includes(requestedResource.toLowerCase()) ||
        module.resourceType.toLowerCase().includes(requestedResource.toLowerCase())
      );

      if (bestMatchModule) {
        const avmDetails = {
          resourceType: bestMatchModule.parsedMarkdown?.resourceTypes?.[0]?.type || bestMatchModule.resourceType || 'Not found',
          apiVersion: bestMatchModule.parsedMarkdown?.resourceTypes?.[0]?.apiVersion || 'Not found',
          brEndpoint: bestMatchModule.parsedMarkdown?.brEndpoint || 'Not found',
          url: provider.getDocumentationUrl(bestMatchModule)
        };

        result[requestedResource] = {
          doc_name: bestMatchModule.moduleDisplayName,
          resource_type: avmDetails.resourceType,
          api_version: avmDetails.apiVersion,
          br_endpoint: avmDetails.brEndpoint,
          provider_type: isTerraform ? 'Terraform' : 'Bicep',
          found: true
        };
      } else {
        result[requestedResource] = {
          doc_name: "Not found",
          resource_type: null,
          api_version: null,
          br_endpoint: null,
          provider_type: "N/A",
          found: false
        };
      }
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.registerTool(
  "get_avm_module_details",
  {
    title: "Get AVM Module Details",
    description: "Get detailed information about a specific AVM module by name",
    inputSchema: {
      moduleName: z.string().describe("The name of the AVM module to get details for"),
      provider: z.enum(['bicep', 'terraform']).optional().default('bicep').describe("Filter by provider type: 'terraform' or 'bicep' (default).")
    }
  },
  async (args: { moduleName: string; provider?: 'bicep' | 'terraform' }) => {
    const isTerraform = args.provider === 'terraform';
    const provider = isTerraform ? terraformProvider : bicepProvider;
    const filteredModules = await provider.loadAllModules();

    const module = filteredModules.find((m: AVMModule) =>
      m.moduleName === args.moduleName ||
      m.moduleDisplayName.toLowerCase().includes(args.moduleName.toLowerCase()) ||
      m.alternativeNames.toLowerCase().includes(args.moduleName.toLowerCase()) ||
      m.resourceType.toLowerCase().includes(args.moduleName.toLowerCase())
    );

    if (!module) {
      return {
        content: [
          {
            type: "text",
            text: `Module not found: ${args.moduleName}`
          }
        ]
      };
    }

    const avmDetails = {
      resourceType: module.parsedMarkdown?.resourceTypes?.[0]?.type || module.resourceType || 'Not found',
      apiVersion: module.parsedMarkdown?.resourceTypes?.[0]?.apiVersion || 'Not found',
      brEndpoint: module.parsedMarkdown?.brEndpoint || 'Not found',
      url: provider.getDocumentationUrl(module)
    };

    const detailsText = `# ${module.moduleDisplayName}

**Provider Namespace:** ${module.providerNamespace}
**Resource Type:** ${module.resourceType}
**Module Name:** ${module.moduleName}
**Status:** ${module.moduleStatus}
**Alternative Names:** ${module.alternativeNames}

## Module Information
- **Parent Module:** ${module.parentModule}
- **Repository URL:** ${module.repoURL}
- **Registry Reference:** ${module.publicRegistryReference}

## Parsed Details
- **Resource Type:** ${avmDetails.resourceType || 'Not found'}
- **API Version:** ${avmDetails.apiVersion || 'Not found'}
- **BR Endpoint:** ${avmDetails.brEndpoint || 'Not found'}
- **Documentation URL:** ${avmDetails.url}

## Description
${module.description}

## Documentation
${module.markdown}`;

    return {
      content: [
        {
          type: "text",
          text: detailsText
        }
      ]
    };
  }
);

server.registerTool(
  "generate_modules",
  {
    title: "Generate Modules",
    description: "Generate the bicep or terraform files that use AVM modules for the selected Azure resources.",
    inputSchema: {
      resources: z.array(z.string()).describe("A list of desired Azure resource types (e.g., 'storage account', 'web app'). The tool will retrieve documentation for these AVM modules."),
      provider: z.enum(['bicep', 'terraform']).optional().default('bicep').describe("Filter by provider type: 'terraform' or 'bicep' (default)."),
      extra_context: z.string().optional().describe("Extra high-level module context provided by the user.")
    },
  },
  async (params: { resources: string[]; provider?: 'bicep' | 'terraform'; extra_context?: string }) => {
    const isTerraform = params.provider === 'terraform';
    const provider = isTerraform ? terraformProvider : bicepProvider;
    const extraContext = params.extra_context || 'No extra context supplied.';

    if (params.resources.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No resources specified. Please provide a list of desired Azure resource types (e.g., 'storage account', 'web app')."
          }
        ]
      };
    }

    const filteredModules = await provider.loadAllModules();
    const providerName = isTerraform ? 'Terraform' : 'Bicep';

    let infoPayload = `
/**
 * Information collected by AVM MCP Server for architecture generation.
 *
 * Use the following documentation to build the ${providerName} architecture.
 * Pay close attention to module paths, parameters, and examples.
 * Provider filter: ${providerName}
 * Each module is marked with its provider type (Bicep or Terraform).
 *
 * Desired high-level architecture context:
 * ${extraContext}
 */

`;
    const collectedDocs: string[] = [];
    const avmNotFound: string[] = [];

    for (const resourceType of params.resources) {
      const bestMatchModule = filteredModules.find((module: AVMModule) =>
        module.moduleDisplayName.toLowerCase().includes(resourceType.toLowerCase()) ||
        module.alternativeNames.toLowerCase().includes(resourceType.toLowerCase()) ||
        module.resourceType.toLowerCase().includes(resourceType.toLowerCase())
      );

      if (bestMatchModule) {
        const isTerraform = bestMatchModule.providerType === 'terraform';
        const currentProvider = isTerraform ? terraformProvider : bicepProvider;

        const avmDetails = {
          resourceType: bestMatchModule.parsedMarkdown?.resourceTypes?.[0]?.type || bestMatchModule.resourceType || 'Not found',
          apiVersion: bestMatchModule.parsedMarkdown?.resourceTypes?.[0]?.apiVersion || 'Not found',
          brEndpoint: bestMatchModule.parsedMarkdown?.brEndpoint || 'Not found',
          url: currentProvider.getDocumentationUrl(bestMatchModule)
        };

        const registryEndpoint = isTerraform ?
          `**Terraform Registry:** \`${bestMatchModule.publicRegistryReference}\`` :
          `**Bicep Registry (BR Endpoint):** \`${avmDetails.brEndpoint}\``;

        collectedDocs.push(
          `### AVM Documentation for: ${resourceType} (Matched to: ${bestMatchModule.moduleDisplayName}) - ${providerName}\n` +
          `**Provider Type:** \`${bestMatchModule.providerType}\`\n` +
          `**Resource Type:** \`${avmDetails.resourceType}\`\n` +
          `**API Version:** \`${avmDetails.apiVersion}\`\n` +
          `${registryEndpoint}\n` +
          `**Documentation Link:** \`${avmDetails.url}\`\n\n` +
          `${bestMatchModule.markdown}\n` +
          `---\n`
        );
      } else {
        avmNotFound.push(resourceType);
      }
    }

    if (collectedDocs.length === 0 && avmNotFound.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: `No ${providerName} AVM documentation could be found for the requested resources: ${avmNotFound.join(', ')}. Please verify the resource names and provider filter. You can list available modules using the 'list_avms' resource, or find available AVMs at https://azure.github.io/Azure-Verified-Modules/indexes/bicep/ (Bicep) or https://azure.github.io/Azure-Verified-Modules/indexes/terraform/ (Terraform).`
          }
        ]
      };
    }

    infoPayload += collectedDocs.join('\n');

    if (avmNotFound.length > 0) {
      infoPayload += `\nWARNING: No ${providerName} AVM documentation found for the following requested resources: ${avmNotFound.join(', ')}.\n`;
      infoPayload += `Please ensure these are valid AVM module names for the specified provider(s). The AI may need to make assumptions or inform the user.\n`;
    }

    return {
      content: [
        {
          type: "text",
          text: infoPayload
        }
      ]
    };
  }
);

const handleShutdown = () => {
  process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
process.on('exit', handleShutdown);

await server.connect(new StdioServerTransport());
