#!/usr/bin/env node

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { load } from "cheerio";

function parseAvmDetailsFromMarkdown(markdownContent: string, avmDocName: string) {
    const details = {
        url: "",
        resourceType: "",
        apiVersion: "",
        brEndpoint: "",
    };

    const resourceTypeRegex = /\|\s*`([^`]+)`\s*\|\s*\[([\d-]{8})\]/m;
    const match = markdownContent.match(resourceTypeRegex);

    if (match && match[1] && match[2]) {
        details.resourceType = match[1].trim();
        details.apiVersion = match[2].trim();
        details.url = markdownContent.split('\n')[0].trim();

        const parts = details.resourceType.split('/');
        if (parts.length >= 2 && parts[0].startsWith('Microsoft.')) {
            details.brEndpoint = `br/public:avm/res/${details.resourceType}:${details.apiVersion}`;
        } else {
            details.brEndpoint = `br/public:avm/res/Microsoft.Unknown/${avmDocName.replace(/-/g, '')}:${details.apiVersion}`;
        }
    } else {
        console.warn(`Could not extract resource type or API version from markdown for ${avmDocName}.`);
        const parts = avmDocName.split('-');
        if (parts.length >= 2) {
            const providerHint = parts[0];
            const resourceTypeHint = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
            details.brEndpoint = `br/public:avm/res/Microsoft.${providerHint}/${resourceTypeHint}s:${details.apiVersion}`;
        } else {
            details.brEndpoint = `br/public:avm/res/Microsoft.Unknown/${avmDocName.replace(/-/g, '')}:${details.apiVersion}`;
        }
    }

    return details;
}

async function getAllModulesFromWebsite(): Promise<Record<string, string>> {
    const response = await fetch("https://azure.github.io/Azure-Verified-Modules/indexes/bicep/bicep-resource-modules/");
    const html = await response.text();
    const $ = load(html);

    const modules: Record<string, string> = {};

    let allModulesSection = $('h3').filter((_, el) => $(el).text().includes('All modules'));

    if (allModulesSection.length === 0) {
        $('table').each((_, table) => {
            const rows = $(table).find('tr');
            if (rows.length > 10) {
                allModulesSection = $(table).prev('h3');
                return false;
            }
        });
    }

    if (allModulesSection.length > 0) {
        let currentElement = allModulesSection.next();

        while (currentElement.length > 0 && !currentElement.is('table')) {
            if (currentElement.find('table').length > 0) {
                currentElement = currentElement.find('table').first();
                break;
            }
            currentElement = currentElement.next();
        }

        if (currentElement.is('table')) {
            currentElement.find('tr').each((_, row) => {
                const cells = $(row).find('td');
                if (cells.length >= 4) {
                    const nameText = $(cells[1]).text().trim();
                    const url = $(cells[1]).find('a').attr('href') || '';
                    modules[nameText] = url;
                }
            });
        }
    }

    if (Object.keys(modules).length === 0) {
        $('table tr').each((_, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 3) {
                const secondCell = $(cells[1]).text().trim();

                const parts = secondCell.split(' ');
                const moduleName = parts[0];

                modules[moduleName] = moduleName;
            }
        });
    }

    return modules;
}

const server = new McpServer({
    name: "AVM MCP Server",
    version: "0.0.1"
});

const modules = await getAllModulesFromWebsite();

server.resource(
    "list_avms",
    "resource://list_avms",
    {
        description: "List all Bicep AVM Modules that have documentation",
        params: z.object({})
    },
    async () => {
        return {
            contents: Object.keys(modules).map(name => ({
                uri: `resource://get_avm_details/${name}`,
                text: name.replace(/-/g, ' ')
            }))
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
            const bestMatchDocName = Object.keys(modules).find(name => name.includes(requestedResource)) || null;
            const docFilePath = bestMatchDocName ? modules[bestMatchDocName] : null;

            if (bestMatchDocName && docFilePath) {
                const markdownContent = await fetch(docFilePath);
                const avmDetails = parseAvmDetailsFromMarkdown(await markdownContent.text(), bestMatchDocName);

                result[requestedResource] = {
                    doc_name: bestMatchDocName,
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
            const bestMatchDocName = Object.keys(modules).find(name => name.includes(resourceType)) || null;
            const docFilePath = bestMatchDocName ? modules[bestMatchDocName] : null;

            if (bestMatchDocName && docFilePath) {
                const markdownContent = await fetch(docFilePath);
                const avmDetails = parseAvmDetailsFromMarkdown(await markdownContent.text(), bestMatchDocName);

                collectedDocs.push(
                    `### AVM Documentation for: ${resourceType} (Matched to: ${bestMatchDocName}.md)\n` +
                    `**Resource Type:** \`${avmDetails.resourceType || 'Not found'}\`\n` +
                    `**API Version:** \`${avmDetails.apiVersion || 'Not found'}\`\n` +
                    `**Suggested Bicep Module Path (BR Endpoint):** \`${avmDetails.brEndpoint || 'Not found'}\`\n` +
                    `**Documentation Link:** \`${avmDetails.url || 'Not found'}\`\n\n` +
                    `${markdownContent}\n` +
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
