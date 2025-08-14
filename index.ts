#!/usr/bin/env node

import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

interface AVMModule {
    providerNamespace: string;
    resourceType: string;
    moduleDisplayName: string;
    alternativeNames: string;
    moduleName: string;
    parentModule: string;
    moduleStatus: string;
    repoURL: string;
    publicRegistryReference: string;
    description: string;
    markdown: string;
}

const parseCsvLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"' && !inQuotes) {
            inQuotes = true;
        } else if (char === '"' && inQuotes) {
            if (nextChar === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = false;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
};

const fetchMarkdownWithRetry = async (url: string, moduleName: string, maxRetries = 3): Promise<{ content: string; status: string }> => {
    if (!url) {
        return { content: '', status: 'no-url' };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                const content = await response.text();
                return { content, status: 'success' };
            }
            if (response.status === 404) {
                return { content: '', status: '404' };
            }
            if (response.status === 403) {
                return { content: '', status: 'rate-limited' };
            }
            return { content: '', status: `http-${response.status}` };
        } catch (error) {
            if (attempt === maxRetries) {
                return { content: '', status: 'network-error' };
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    return { content: '', status: 'unknown-error' };
};

const getAllModules = async (): Promise<AVMModule[]> => {
    const response = await fetch("https://raw.githubusercontent.com/Azure/Azure-Verified-Modules/refs/heads/main/docs/static/module-indexes/BicepResourceModules.csv");

    const csvData = await response.text();

    const lines = csvData.split('\n').filter(line => line.trim());

    const modulePromises: Promise<AVMModule>[] = [];
    const fetchStats = {
        success: 0,
        notFound: 0,
        rateLimited: 0,
        networkError: 0,
        noUrl: 0,
        other: 0
    };

    for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        const moduleStatus = values[6] || '';

        if (moduleStatus.toLowerCase() === 'proposed') {
            continue;
        }

        const repoURL = values[7] || '';
        const moduleName = values[4] || `module-${i}`;

        const modulePromise = (async (): Promise<AVMModule> => {
            let markdownContent = '';
            let fetchStatus = 'no-url';

            if (repoURL) {
                const readmeURL = repoURL + '/README.md';
                const result = await fetchMarkdownWithRetry(readmeURL, moduleName);
                markdownContent = result.content;
                fetchStatus = result.status;
            }

            switch (fetchStatus) {
                case 'success':
                    fetchStats.success++;
                    break;
                case '404':
                    fetchStats.notFound++;
                    break;
                case 'rate-limited':
                    fetchStats.rateLimited++;
                    break;
                case 'network-error':
                    fetchStats.networkError++;
                    break;
                case 'no-url':
                    fetchStats.noUrl++;
                    break;
                default:
                    fetchStats.other++;
                    break;
            }

            return {
                providerNamespace: values[0] || '',
                resourceType: values[1] || '',
                moduleDisplayName: values[2] || '',
                alternativeNames: values[3] || '',
                moduleName: values[4] || '',
                parentModule: values[5] || '',
                moduleStatus: values[6] || '',
                repoURL: values[7] || '',
                publicRegistryReference: values[8] || '',
                description: values[16] || '',
                markdown: markdownContent
            };
        })();

        modulePromises.push(modulePromise);
    }

    const batchSize = 20;
    const modules: AVMModule[] = [];

    for (let i = 0; i < modulePromises.length; i += batchSize) {
        const batch = modulePromises.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(batch);

        batchResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                modules.push(result.value);
            } else {
                const values = parseCsvLine(lines[i + index + 1]);
                modules.push({
                    providerNamespace: values[0] || '',
                    resourceType: values[1] || '',
                    moduleDisplayName: values[2] || '',
                    alternativeNames: values[3] || '',
                    moduleName: values[4] || '',
                    parentModule: values[5] || '',
                    moduleStatus: values[6] || '',
                    repoURL: values[7] || '',
                    publicRegistryReference: values[8] || '',
                    description: values[16] || '',
                    markdown: ''
                });
            }
        });

        if (i + batchSize < modulePromises.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return modules;
};

const parseAvmDetailsFromMarkdown = (markdownContent: string, moduleName: string) => {
    // Extract resource type, API version, and BR endpoint from markdown content
    // This is a simplified parser - adjust based on actual markdown structure
    const resourceTypeMatch = markdownContent.match(/Resource Type[:\s]*([^\n\r]+)/i);
    const apiVersionMatch = markdownContent.match(/API Version[:\s]*([^\n\r]+)/i);
    const brEndpointMatch = markdownContent.match(/br\/public:([^\s\n\r]+)/);

    return {
        resourceType: resourceTypeMatch ? resourceTypeMatch[1].trim() : null,
        apiVersion: apiVersionMatch ? apiVersionMatch[1].trim() : null,
        brEndpoint: brEndpointMatch ? `br/public:${brEndpointMatch[1]}` : null,
        url: `https://github.com/Azure/bicep-registry-modules/tree/main/${moduleName}`
    };
};

const server = new McpServer({
    name: "AVM MCP Server",
    version: "0.0.1"
});

const modules = await getAllModules();

server.registerResource(
    "list_avms",
    "resource://list_avms",
    {
        title: "List AVM Modules",
        description: "List all Bicep AVM Modules that have documentation"
    },
    async () => {
        return {
            contents: modules.map(module => ({
                uri: `resource://get_avm_details/${module.moduleName}`,
                text: module.moduleDisplayName
            }))
        };
    }
);

server.registerResource(
    "get_avm_details",
    new ResourceTemplate("resource://get_avm_details/{moduleName}", { list: undefined }),
    {
        title: "Get AVM Module Details",
        description: "Get detailed information about a specific AVM module",
    },
    async (_, { moduleName }) => {
        const module = modules.find(m => m.moduleName === moduleName);

        if (!module) {
            return {
                contents: [{
                    uri: `resource://get_avm_details/${moduleName}`,
                    text: `Module not found: ${moduleName}`
                }]
            };
        }

        const avmDetails = parseAvmDetailsFromMarkdown(module.markdown, module.moduleName);

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
                uri: `resource://get_avm_details/${moduleName}`,
                text: detailsText
            }]
        };
    }
);

server.tool(
    "mcp_find_avms",
    {
        resources: z.array(z.string()).describe("A list of desired Azure resource types (e.g., 'storage account', 'web app').")
    },
    async (args) => {
        const result: Record<string, { doc_name: string; resource_type: string | null; api_version: string | null; br_endpoint: string | null; found: boolean }> = {};
        for (const requestedResource of args.resources) {
            const bestMatchModule = modules.find(module =>
                module.moduleDisplayName.toLowerCase().includes(requestedResource.toLowerCase()) ||
                module.alternativeNames.toLowerCase().includes(requestedResource.toLowerCase()) ||
                module.resourceType.toLowerCase().includes(requestedResource.toLowerCase())
            );

            if (bestMatchModule) {
                const avmDetails = parseAvmDetailsFromMarkdown(bestMatchModule.markdown, bestMatchModule.moduleName);

                result[requestedResource] = {
                    doc_name: bestMatchModule.moduleDisplayName,
                    resource_type: avmDetails.resourceType,
                    api_version: avmDetails.apiVersion,
                    br_endpoint: avmDetails.brEndpoint,
                    found: true
                };
            } else {
                result[requestedResource] = {
                    doc_name: "Not found",
                    resource_type: null,
                    api_version: null,
                    br_endpoint: null,
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

server.tool(
    "generate_architecture",
    {
        resources: z.array(z.string()).describe("A list of desired Azure resource types (e.g., 'storage account', 'web app'). The tool will retrieve documentation for these AVMs."),
        extra_context: z.string().optional().describe("Extra high-level architecture context provided by the user.")
    },
    async (params) => {
        const resourcesToInclude: string[] = params.resources || [];
        const extraContext = params.extra_context || 'No extra context supplied.';

        if (resourcesToInclude.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No resources specified. Please provide a list of desired Azure resource types (e.g., 'storage account', 'web app')."
                    }
                ]
            };
        }

        let infoPayload = `
/**
 * Information collected by AVM MCP Server for architecture generation.
 *
 * Use the following documentation to build the Bicep architecture.
 * Pay close attention to module paths, parameters, and examples.
 *
 * Desired high-level architecture context:
 * ${extraContext}
 */

`;
        const collectedDocs: string[] = [];
        const avmNotFound: string[] = [];

        for (const resourceType of resourcesToInclude) {
            const bestMatchModule = modules.find(module =>
                module.moduleDisplayName.toLowerCase().includes(resourceType.toLowerCase()) ||
                module.alternativeNames.toLowerCase().includes(resourceType.toLowerCase()) ||
                module.resourceType.toLowerCase().includes(resourceType.toLowerCase())
            );

            if (bestMatchModule) {
                const avmDetails = parseAvmDetailsFromMarkdown(bestMatchModule.markdown, bestMatchModule.moduleName);

                collectedDocs.push(
                    `### AVM Documentation for: ${resourceType} (Matched to: ${bestMatchModule.moduleDisplayName})\n` +
                    `**Resource Type:** \`${avmDetails.resourceType || 'Not found'}\`\n` +
                    `**API Version:** \`${avmDetails.apiVersion || 'Not found'}\`\n` +
                    `**Suggested Bicep Module Path (BR Endpoint):** \`${avmDetails.brEndpoint || 'Not found'}\`\n` +
                    `**Documentation Link:** \`${avmDetails.url || 'Not found'}\`\n\n` +
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
                        text: `No AVM documentation could be found for the requested resources: ${avmNotFound.join(', ')}. Please verify the resource names. You can list available modules using the 'list_avms' resource, or find available AVMs at https://azure.github.io/Azure-Verified-Modules/indexes/bicep/.`
                    }
                ]
            };
        }

        infoPayload += collectedDocs.join('\n');

        if (avmNotFound.length > 0) {
            infoPayload += `\nWARNING: No AVM documentation found for the following requested resources: ${avmNotFound.join(', ')}.\n`;
            infoPayload += `Please ensure these are valid AVM module names. The AI may need to make assumptions or inform the user.\n`;
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

const log = (message: string) => {
    console.info(`\n[${new Date().toISOString()}] ${message}`);
};

const handleShutdown = () => {
    log(`AVM MCP Server received shutdown signal, shutting down gracefully...`);
    process.exit(0);
};

log(`AVM MCP Server starting...`);

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
process.on('exit', handleShutdown);

await server.connect(new StdioServerTransport());

log(`AVM MCP Server started successfully and listening for connections`);
