import { marked } from "marked";
import type { AVMModule, ParsedMarkdown, MarkdownSection } from "../types.js";
import { AbstractAvmProvider } from "./AbstractAvmProvider.js";
import { BICEP_CSV_URL, BICEP_DOCS_BASE_URL, BR_PUBLIC_PREFIX } from "../constants.js";

export class BicepAvmProvider extends AbstractAvmProvider {
  protected getIndexCsvUrl(): string {
    return BICEP_CSV_URL;
  }

  protected shouldIncludeRow(row: string[]): boolean {
    const moduleStatus = (row[6] || "").toLowerCase();
    return moduleStatus !== "proposed";
  }

  protected getRepoUrlFromRow(row: string[]): string {
    return row[7] || "";
  }

  protected getModuleNameFromRow(row: string[], fallbackIndex: number): string {
    return row[4] || `module-${fallbackIndex}`;
  }

  public getDocumentationUrl(module: AVMModule): string {
    return `${BICEP_DOCS_BASE_URL}/${module.moduleName}`;
  }

  protected mapRowToModule(row: string[], markdown: string, parsed?: ParsedMarkdown): AVMModule {
    return {
      providerNamespace: row[0] || "",
      resourceType: row[1] || "",
      moduleDisplayName: row[2] || "",
      alternativeNames: row[3] || "",
      moduleName: row[4] || "",
      parentModule: row[5] || "",
      moduleStatus: row[6] || "",
      repoURL: row[7] || "",
      publicRegistryReference: row[8] || "",
      description: row[16] || "",
      markdown,
      parsedMarkdown: parsed,
      providerType: 'bicep'
    };
  }

  protected parseDocumentation(markdownContent: string): ParsedMarkdown {
    if (!markdownContent || markdownContent.trim() === "") {
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

    const tokens = marked.lexer(markdownContent);

    let currentSection: MarkdownSection | null = null;
    let currentSectionContent = "";

    // Escape regex special chars in prefix
    const escapedBrPrefix = BR_PUBLIC_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const brRegex = new RegExp(escapedBrPrefix + "([^\\s\\n\\r<>`]+)");

    for (const token of tokens) {
      if (token.type === "heading") {
        if (currentSection) {
          currentSection.content = currentSectionContent.trim();
          parsed.sections.push(currentSection);
        }
        currentSection = {
          title: token.text,
          level: (token as any).depth,
          content: "",
          anchor: token.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        };
        currentSectionContent = "";
        if ((token as any).depth === 1 && !parsed.title) {
          parsed.title = token.text;
        }
      } else if (token.type === "code") {
        parsed.codeBlocks.push({
          language: (token as any).lang || undefined,
          code: (token as any).text,
          context: currentSection?.title
        });
        if (currentSection && (
          currentSection.title.toLowerCase().includes("example") ||
          currentSection.title.toLowerCase().includes("usage")
        )) {
          parsed.examples.push({
            title: currentSection.title,
            code: (token as any).text,
            language: (token as any).lang || undefined
          });
        }
        currentSectionContent += `\`\`\`${(token as any).lang || ''}\n${(token as any).text}\n\`\`\`\n\n`;
      } else if (token.type === "paragraph" || token.type === "text") {
        const text = (token as any).text || "";
        currentSectionContent += text + "\n\n";
        if (!parsed.description && currentSection?.level === 1) {
          parsed.description = text.substring(0, 200) + (text.length > 200 ? "..." : "");
        }
        const brMatch = text.match(brRegex);
        if (brMatch && !parsed.brEndpoint) {
          parsed.brEndpoint = `${BR_PUBLIC_PREFIX}${brMatch[1]}`;
        }
      } else if (token.type === "table") {
        const headers = (token as any).header.map((h: any) => h.text.toLowerCase());
        for (const row of (token as any).rows) {
          const rowData: Record<string, string> = {};
          headers.forEach((header: string, index: number) => {
            rowData[header] = row[index]?.text || "";
          });
          if (headers.includes("parameter") || headers.includes("name")) {
            if (currentSection?.title.toLowerCase().includes("parameter")) {
              parsed.parameters.push({
                name: rowData.parameter || rowData.name || "",
                type: rowData.type || undefined,
                required: rowData.required === "Yes" || rowData.required === "true",
                defaultValue: rowData.default || rowData["default value"] || undefined,
                description: rowData.description || undefined
              });
            }
          }
          if (headers.includes("resource type")) {
            parsed.resourceTypes.push({
              type: rowData["resource type"] || "",
              apiVersion: rowData["api version"] || undefined,
              reference: rowData.references || rowData.reference || undefined
            });
          }
          if (headers.includes("output") || (currentSection?.title.toLowerCase().includes("output") && headers.includes("name"))) {
            parsed.outputs.push({
              name: rowData.output || rowData.name || "",
              type: rowData.type || undefined,
              description: rowData.description || undefined
            });
          }
        }
        currentSectionContent += `[Table with ${(token as any).rows.length} rows]\n\n`;
      } else if (token.type === "list") {
        const listItems = (token as any).items.map((item: any) =>
          typeof item === "string" ? item : item.text || ""
        ).join("\n- ");
        currentSectionContent += `- ${listItems}\n\n`;
      } else {
        if ((token as any).text) {
          currentSectionContent += (token as any).text + "\n\n";
        }
      }
    }

    if (currentSection) {
      currentSection.content = currentSectionContent.trim();
      parsed.sections.push(currentSection);
    }

    const usageSection = parsed.sections.find(s =>
      s.title.toLowerCase().includes("usage") ||
      s.title.toLowerCase().includes("deployment") ||
      s.title.toLowerCase().includes("quick start")
    );
    if (usageSection) {
      parsed.usageInstructions = usageSection.content;
    }

    return parsed;
  }
} 