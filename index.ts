import type { Request, Response } from "express";

import express from "express";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.use(express.json());

function normalizeString(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function calculateSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    const words1 = s1.split(/\s+/).filter(Boolean);
    const words2 = s2.split(/\s+/).filter(Boolean);

    if (words1.length === 0 || words2.length === 0) return 0.0;

    let commonWords = 0;
    const longerWords = words1.length > words2.length ? words1 : words2;
    const shorterWords = words1.length <= words2.length ? words1 : words2;

    for (const word of shorterWords) {
        if (longerWords.includes(word)) {
            commonWords++;
        }
    }

    if (s1.includes(s2) || s2.includes(s1)) {
        return Math.max(commonWords / longerWords.length, 0.5);
    }

    if (words1.length === 1 && words2.length === 1) {
        if (s1.includes(s2) || s2.includes(s1)) {
            return Math.max(s1.length, s2.length) / Math.max(s1.length, s2.length);
        }
    }

    return commonWords / longerWords.length;
}

function findBestAvmDocMatch(requestedResource: string, allDocFiles: string[], similarityThreshold: number = 0.6): string | null {
    const normalizedRequested = normalizeString(requestedResource);
    let bestMatch: string | null = null;
    let highestScore = 0.0;

    if (!normalizedRequested) {
        return null;
    }

    for (const docFile of allDocFiles) {
        const docBaseName = docFile.replace(".md", "");
        const normalizedDocName = normalizeString(docBaseName.replace(/-/g, ' '));

        const score = calculateSimilarity(normalizedRequested, normalizedDocName);

        if (score === 1.0) {
            return docBaseName;
        }

        if (score > highestScore && score >= similarityThreshold) {
            highestScore = score;
            bestMatch = docBaseName;
        }
    }

    if (bestMatch === null) {
        const partial = normalizedRequested.split(/\s+/);
        let exactMatch = "";
        for (const requestedItem of partial) {
            const desiredFileName = `${requestedItem}.md`;
            if (allDocFiles.includes(desiredFileName)) {
                exactMatch = desiredFileName;
            }
        }

        if (exactMatch) {
            return exactMatch.replace(".md", "");
        }

        const partialMatch = allDocFiles.find(df => {
            const normalizedDocName = normalizeString(df.replace(".md", ""));
            return partial.some(word => normalizedDocName.includes(word));
        });

        if (partialMatch) {
            return partialMatch.replace(".md", "");
        }
    }

    return bestMatch;
}

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
            details.brEndpoint = `br/public:avm/res/${details.resourceType}:1.0.0`;
        } else {
            details.brEndpoint = `br/public:avm/res/Microsoft.Unknown/${avmDocName.replace(/-/g, '')}:1.0.0`;
        }
    } else {
        console.warn(`Could not extract resource type or API version from markdown for ${avmDocName}.`);
        const parts = avmDocName.split('-');
        if (parts.length >= 2) {
            const providerHint = parts[0];
            const resourceTypeHint = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
            details.brEndpoint = `br/public:avm/res/Microsoft.${providerHint}/${resourceTypeHint}s:1.0.0`;
        } else {
            details.brEndpoint = `br/public:avm/res/Microsoft.Unknown/${avmDocName.replace(/-/g, '')}:1.0.0`;
        }
    }

    return details;
}

app.post('/mcp', async (req: Request, res: Response) => {
    try {
        const server = new McpServer({
            name: "AVM MCP Server",
            version: "1.0.0"
        });

        const allDocFiles = readdirSync(resolve("./docs")).filter(name => name.endsWith(".md"));

        server.resource(
            "list_avms",
            "resource://list_avms",
            {
                description: "List all Bicep AVM Modules that have documentation",
                params: z.object({})
            },
            async () => {
                return {
                    contents: allDocFiles.map(name => ({
                        uri: `resource://get_avm_details/${name.replace(".md", "")}`,
                        text: name.replace(".md", "").replace(/-/g, ' ')
                    }))
                };
            }
        );

        server.resource(
            "get_avm_details",
            new ResourceTemplate("resource://get_avm_details/{avm_name}", { list: undefined }),
            async (uri, { avm_name }) => {
                const avmBase = resolve("./docs", `${avm_name}.md`);
                if (!existsSync(avmBase)) {
                    throw new Error(`AVM documentation not found for: ${avm_name}.`);
                }
                return {
                    contents: [{
                        uri: `resource://get_avm_details/${avm_name}`,
                        text: readFileSync(avmBase, "utf-8")
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
                    const bestMatchDocName = findBestAvmDocMatch(requestedResource, allDocFiles);
                    const docFilePath = bestMatchDocName ? resolve("./docs", `${bestMatchDocName}.md`) : null;

                    if (bestMatchDocName && docFilePath && existsSync(docFilePath)) {
                        const markdownContent = readFileSync(docFilePath, "utf-8");
                        const avmDetails = parseAvmDetailsFromMarkdown(markdownContent, bestMatchDocName);

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


        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

        res.on('close', () => {
            console.log('Request closed');
            transport.close();
            server.close();
        });

        await server.connect(transport);

        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error',
                },
                id: null,
            });
        }
    }
});

app.get('/mcp', async (req: Request, res: Response) => {
    console.log('Received GET MCP request');
    res.writeHead(405).end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
            code: -32000,
            message: "Method not allowed."
        },
        id: null
    }));
});

app.delete('/mcp', async (req: Request, res: Response) => {
    console.log('Received DELETE MCP request');
    res.writeHead(405).end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
            code: -32000,
            message: "Method not allowed."
        },
        id: null
    }));
});

app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});
