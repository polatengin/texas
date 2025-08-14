#!/usr/bin/env node

import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { marked } from "marked";

interface MarkdownSection {
    title: string;
    level: number;
    content: string;
    anchor?: string;
}

interface ParsedMarkdown {
    title?: string;
    description?: string;
    sections: MarkdownSection[];
    codeBlocks: Array<{
        language?: string;
        code: string;
        context?: string;
    }>;
    parameters: Array<{
        name: string;
        type?: string;
        required?: boolean;
        defaultValue?: string;
        description?: string;
    }>;
    examples: Array<{
        title?: string;
        description?: string;
        code: string;
        language?: string;
    }>;
    resourceTypes: Array<{
        type: string;
        apiVersion?: string;
        reference?: string;
    }>;
    outputs: Array<{
        name: string;
        type?: string;
        description?: string;
    }>;
    usageInstructions?: string;
    brEndpoint?: string;
}

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
    parsedMarkdown?: ParsedMarkdown;
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

const parseMarkdownContent = (markdownContent: string): ParsedMarkdown => {
    if (!markdownContent || markdownContent.trim() === '') {
        return {
            sections: [],
            codeBlocks: [],
            parameters: [],
            examples: [],
            resourceTypes: [],
            outputs: []
        };
    }

    const parsed: ParsedMarkdown = {
        sections: [],
        codeBlocks: [],
        parameters: [],
        examples: [],
        resourceTypes: [],
        outputs: []
    };

    // Parse markdown using marked and extract tokens
    const tokens = marked.lexer(markdownContent);
    
    let currentSection: MarkdownSection | null = null;
    let currentSectionContent = '';
    
    for (const token of tokens) {
        if (token.type === 'heading') {
            // Save previous section if exists
            if (currentSection) {
                currentSection.content = currentSectionContent.trim();
                parsed.sections.push(currentSection);
            }
            
            // Start new section
            currentSection = {
                title: token.text,
                level: token.depth,
                content: '',
                anchor: token.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            };
            currentSectionContent = '';
            
            // Extract main title and description
            if (token.depth === 1 && !parsed.title) {
                parsed.title = token.text;
            }
        } else if (token.type === 'code') {
            // Extract code blocks
            parsed.codeBlocks.push({
                language: token.lang || undefined,
                code: token.text,
                context: currentSection?.title
            });
            
            // Check if it's an example
            if (currentSection && (
                currentSection.title.toLowerCase().includes('example') ||
                currentSection.title.toLowerCase().includes('usage')
            )) {
                parsed.examples.push({
                    title: currentSection.title,
                    code: token.text,
                    language: token.lang || undefined
                });
            }
            
            currentSectionContent += `\`\`\`${token.lang || ''}\n${token.text}\n\`\`\`\n\n`;
        } else if (token.type === 'paragraph' || token.type === 'text') {
            const text = token.text || '';
            currentSectionContent += text + '\n\n';
            
            // Extract description from first paragraph if not set
            if (!parsed.description && currentSection?.level === 1) {
                parsed.description = text.substring(0, 200) + (text.length > 200 ? '...' : '');
            }
            
            // Extract BR endpoint
            const brMatch = text.match(/br\/public:([^\s\n\r<>`]+)/);
            if (brMatch && !parsed.brEndpoint) {
                parsed.brEndpoint = `br/public:${brMatch[1]}`;
            }
        } else if (token.type === 'table') {
            // Parse tables for parameters, outputs, etc.
            const headers = (token as any).header.map((h: any) => h.text.toLowerCase());
            
            for (const row of (token as any).rows) {
                const rowData: Record<string, string> = {};
                headers.forEach((header: string, index: number) => {
                    rowData[header] = row[index]?.text || '';
                });
                
                // Check if this is a parameters table
                if (headers.includes('parameter') || headers.includes('name')) {
                    if (currentSection?.title.toLowerCase().includes('parameter')) {
                        parsed.parameters.push({
                            name: rowData.parameter || rowData.name || '',
                            type: rowData.type || undefined,
                            required: rowData.required === 'Yes' || rowData.required === 'true',
                            defaultValue: rowData.default || rowData['default value'] || undefined,
                            description: rowData.description || undefined
                        });
                    }
                }
                
                // Check if this is a resource types table
                if (headers.includes('resource type')) {
                    parsed.resourceTypes.push({
                        type: rowData['resource type'] || '',
                        apiVersion: rowData['api version'] || undefined,
                        reference: rowData.references || rowData.reference || undefined
                    });
                }
                
                // Check if this is an outputs table
                if (headers.includes('output') || (currentSection?.title.toLowerCase().includes('output') && headers.includes('name'))) {
                    parsed.outputs.push({
                        name: rowData.output || rowData.name || '',
                        type: rowData.type || undefined,
                        description: rowData.description || undefined
                    });
                }
            }
            
            currentSectionContent += `[Table with ${(token as any).rows.length} rows]\n\n`;
        } else if (token.type === 'list') {
            // Handle lists
            const listItems = (token as any).items.map((item: any) => 
                typeof item === 'string' ? item : item.text || ''
            ).join('\n- ');
            currentSectionContent += `- ${listItems}\n\n`;
        } else {
            // Handle other content types
            if ('text' in token) {
                currentSectionContent += token.text + '\n\n';
            }
        }
    }
    
    // Don't forget the last section
    if (currentSection) {
        currentSection.content = currentSectionContent.trim();
        parsed.sections.push(currentSection);
    }
    
    // Extract usage instructions from specific sections
    const usageSection = parsed.sections.find(s => 
        s.title.toLowerCase().includes('usage') || 
        s.title.toLowerCase().includes('deployment') ||
        s.title.toLowerCase().includes('quick start')
    );
    if (usageSection) {
        parsed.usageInstructions = usageSection.content;
    }
    
    return parsed;
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
                markdown: markdownContent,
                parsedMarkdown: markdownContent ? parseMarkdownContent(markdownContent) : undefined
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

server.registerTool(
    "mcp_find_avms",
    {
        title: "Find AVM Modules",
        description: "Find AVM modules based on resource types",
        inputSchema: {
            resources: z.array(z.string()).describe("A list of desired Azure resource types (e.g., 'storage account', 'web app').")
        }
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

server.registerTool(
    "generate_architecture",
    {
        title: "Generate Architecture",
        description: "Generate a high-level architecture diagram based on the selected Azure resources.",
        inputSchema: {
            resources: z.array(z.string()).describe("A list of desired Azure resource types (e.g., 'storage account', 'web app'). The tool will retrieve documentation for these AVMs."),
            extra_context: z.string().optional().describe("Extra high-level architecture context provided by the user.")
        },
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

const handleShutdown = () => {
    process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
process.on('exit', handleShutdown);

await server.connect(new StdioServerTransport());
