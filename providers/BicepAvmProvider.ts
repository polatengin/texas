import { marked } from "marked";
import type { AVMModule, ParsedMarkdown } from "../types.js";
import { AbstractAvmProvider } from "./AbstractAvmProvider.js";
import { BICEP_CSV_URL } from "../constants.js";

export class BicepAvmProvider extends AbstractAvmProvider {
  protected getIndexCsvUrl(): string {
    return BICEP_CSV_URL;
  }

  protected getReadmeUrl(repoURL: string): string {
    // For Bicep, just append /README.md to the repo URL
    // The reference code shows: const readmeURL = repoURL + '/README.md';
    return repoURL ? `${repoURL}/README.md` : '';
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
    return `https://github.com/Azure/bicep-registry-modules/tree/main/${module.moduleName}`;
  }

  protected mapRowToModule(row: string[], markdown: string, parsed?: ParsedMarkdown): AVMModule {
    return {
      providerNamespace: row[0] || '',
      resourceType: row[1] || '',
      moduleDisplayName: row[2] || '',
      alternativeNames: row[3] || '',
      moduleName: row[4] || '',
      parentModule: row[5] || '',
      moduleStatus: row[6] || '',
      repoURL: row[7] || '',
      publicRegistryReference: row[8] || '',
      description: row[16] || '',
      markdown: markdown,
      parsedMarkdown: parsed,
      providerType: 'bicep'
    };
  }

  protected parseDocumentation(markdownContent: string): ParsedMarkdown {
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
    
    let currentSection: any = null;
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
        // Extract code blocks (without source property)
        parsed.codeBlocks.push({
          language: token.lang || undefined,
          code: token.text,
          context: currentSection?.title
        });
        
        // Check if it's an example
        if (currentSection && (
          currentSection.title.toLowerCase().includes('example') ||
          currentSection.title.toLowerCase().includes('usage') ||
          currentSection.title.toLowerCase().includes('deployment') ||
          currentSection.title.toLowerCase().includes('quick start')
        )) {
          parsed.examples.push({
            title: currentSection.title,
            code: token.text,
            language: token.lang || undefined
            // Removed source property as it's not in the type definition
          });
        }
        
        currentSectionContent += `\`\`\`${token.lang || ''}\n${token.text}\n\`\`\`\n\n`;
      } else if (token.type === 'paragraph') {
        const text = token.text || '';
        currentSectionContent += text + '\n\n';
        
        // Extract description from first paragraph if not set
        if (!parsed.description && currentSection?.level === 1) {
          parsed.description = text.substring(0, 200) + (text.length > 200 ? '...' : '');
        }
        
        // Extract BR endpoint - look for various patterns
        const brPatterns = [
          /br\/public:([^\s\n\r<>`]+)/,
          /br:([^\s\n\r<>`]+)/,
          /mcr\.microsoft\.com\/bicep\/([^\s\n\r<>`]+)/
        ];
        
        for (const pattern of brPatterns) {
          const brMatch = text.match(pattern);
          if (brMatch && !parsed.brEndpoint) {
            if (pattern === brPatterns[0]) {
              parsed.brEndpoint = `br/public:${brMatch[1]}`;
            } else if (pattern === brPatterns[1]) {
              parsed.brEndpoint = `br:${brMatch[1]}`;
            } else {
              parsed.brEndpoint = `br:mcr.microsoft.com/bicep/${brMatch[1]}`;
            }
            break;
          }
        }
      } else if (token.type === 'table') {
        // Parse tables for parameters, outputs, etc.
        const headers = (token as any).header?.map((h: any) => 
          (typeof h === 'string' ? h : h.text || '').toLowerCase()
        ) || [];
        
        const rows = (token as any).rows || [];
        
        for (const row of rows) {
          const rowData: Record<string, string> = {};
          headers.forEach((header: string, index: number) => {
            const cell = row[index];
            rowData[header] = typeof cell === 'string' ? cell : (cell?.text || '');
          });
          
          // Check if this is a parameters table
          if (currentSection?.title.toLowerCase().includes('parameter') || 
              headers.includes('parameter') || 
              headers.includes('name')) {
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
          if (headers.includes('resource type') || 
              (currentSection?.title.toLowerCase().includes('resource') && headers.includes('type'))) {
            parsed.resourceTypes.push({
              type: rowData['resource type'] || rowData.type || '',
              apiVersion: rowData['api version'] || rowData.apiversion || undefined,
              reference: rowData.references || rowData.reference || undefined
            });
          }
          
          // Check if this is an outputs table
          if (headers.includes('output') || 
              (currentSection?.title.toLowerCase().includes('output') && headers.includes('name'))) {
            parsed.outputs.push({
              name: rowData.output || rowData.name || '',
              type: rowData.type || undefined,
              description: rowData.description || undefined
            });
          }
        }
        
        currentSectionContent += `[Table with ${rows.length} rows]\n\n`;
      } else if (token.type === 'list') {
        // Handle lists
        const items = (token as any).items || [];
        const listContent = items.map((item: any) => {
          if (typeof item === 'string') return `- ${item}`;
          if (item.text) return `- ${item.text}`;
          if (item.tokens) {
            return `- ${item.tokens.map((t: any) => t.text || '').join('')}`;
          }
          return '';
        }).join('\n');
        
        currentSectionContent += listContent + '\n\n';
      } else if (token.type === 'text' || token.type === 'space' || token.type === 'hr') {
        // Handle other content types
        if ('text' in token) {
          currentSectionContent += (token.text || '') + '\n\n';
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
      s.title.toLowerCase().includes('quick start') ||
      s.title.toLowerCase().includes('example')
    );
    
    if (usageSection) {
      parsed.usageInstructions = usageSection.content;
    }
    
    // If no BR endpoint found in text, check code blocks for module references
    if (!parsed.brEndpoint) {
      for (const codeBlock of parsed.codeBlocks) {
        if (codeBlock.language === 'bicep' || !codeBlock.language) {
          const moduleMatch = codeBlock.code.match(/module\s+\w+\s+['"]([^'"]+)['"]/);
          if (moduleMatch && moduleMatch[1].startsWith('br')) {
            parsed.brEndpoint = moduleMatch[1];
            break;
          }
        }
      }
    }
    
    return parsed;
  }
}