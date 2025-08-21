import { marked } from "marked";
import type { AVMModule, ParsedMarkdown } from "../types.js";
import { AbstractAvmProvider } from "./AbstractAvmProvider.js";
import { TERRAFORM_CSV_URL } from "../constants.js";

export class TerraformAvmProvider extends AbstractAvmProvider {
  protected getIndexCsvUrl(): string {
    return TERRAFORM_CSV_URL;
  }

  protected getReadmeUrl(repoURL: string): string {
    // Convert GitHub repo URL to raw content URL for README.md
    if (!repoURL) return '';
    
    if (repoURL.includes('github.com')) {
      // Convert from https://github.com/owner/repo to https://raw.githubusercontent.com/owner/repo/main/README.md
      return repoURL.replace('github.com', 'raw.githubusercontent.com') + '/main/README.md';
    }
    
    // Fallback for non-GitHub URLs
    return `${repoURL}/README.md`;
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
    // Terraform modules use the repo URL directly
    return module.repoURL || '';
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
      providerType: 'terraform'
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
        // Extract code blocks
        parsed.codeBlocks.push({
          language: token.lang || undefined,
          code: token.text,
          context: currentSection?.title
        });
        
        // Check if it's an example - Terraform uses HCL/Terraform language
        if (currentSection && (
          currentSection.title.toLowerCase().includes('example') ||
          currentSection.title.toLowerCase().includes('usage') ||
          currentSection.title.toLowerCase().includes('basic') ||
          currentSection.title.toLowerCase().includes('complete') ||
          currentSection.title.toLowerCase().includes('quick start')
        )) {
          parsed.examples.push({
            title: currentSection.title,
            code: token.text,
            language: token.lang || undefined
          });
        } else if (token.lang === 'hcl' || token.lang === 'terraform') {
          // Also consider any HCL/Terraform code block as potential example
          parsed.examples.push({
            title: currentSection?.title || 'Code Example',
            code: token.text,
            language: token.lang
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
        
        // Extract Terraform registry reference
        const registryPatterns = [
          /registry\.terraform\.io\/modules\/([^\s\n\r<>`]+)/,
          /module\s+"([^"]+)"/,
          /source\s*=\s*"([^"]+)"/
        ];
        
        for (const pattern of registryPatterns) {
          const match = text.match(pattern);
          if (match && !parsed.brEndpoint) {
            parsed.brEndpoint = match[1];
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
          
          // Check if this is a variables/inputs table (Terraform uses different naming)
          if (currentSection?.title.toLowerCase().includes('input') || 
              currentSection?.title.toLowerCase().includes('variable') ||
              headers.includes('variable') || 
              headers.includes('name')) {
            if (currentSection?.title.toLowerCase().includes('input') || 
                currentSection?.title.toLowerCase().includes('variable')) {
              parsed.parameters.push({
                name: rowData.variable || rowData.name || '',
                type: rowData.type || undefined,
                required: rowData.required === 'yes' || rowData.required === 'true' || rowData.default === 'n/a',
                defaultValue: rowData.default || rowData['default value'] || undefined,
                description: rowData.description || undefined
              });
            }
          }
          
          // Check if this is a resources table
          if (headers.includes('resource') || 
              (currentSection?.title.toLowerCase().includes('resource') && headers.includes('type'))) {
            parsed.resourceTypes.push({
              type: rowData.resource || rowData.type || '',
              apiVersion: rowData['api version'] || undefined,
              reference: rowData.reference || rowData.link || undefined
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
        
        // Extract resource types from lists if in resources section
        if (currentSection?.title.toLowerCase().includes('resource')) {
          const resourceMatches = listContent.match(/azurerm_[a-z_]+/g);
          if (resourceMatches) {
            resourceMatches.forEach((resource: string) => {
              if (!parsed.resourceTypes.find(r => r.type === resource)) {
                parsed.resourceTypes.push({ type: resource });
              }
            });
          }
        }
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
      s.title.toLowerCase().includes('example') ||
      s.title.toLowerCase().includes('getting started') ||
      s.title.toLowerCase().includes('quick start')
    );
    
    if (usageSection) {
      parsed.usageInstructions = usageSection.content;
    }
    
    // If no registry reference found, check code blocks for module source
    if (!parsed.brEndpoint) {
      for (const codeBlock of parsed.codeBlocks) {
        if (codeBlock.language === 'hcl' || codeBlock.language === 'terraform' || !codeBlock.language) {
          const sourceMatch = codeBlock.code.match(/source\s*=\s*"([^"]+)"/);
          if (sourceMatch) {
            parsed.brEndpoint = sourceMatch[1];
            break;
          }
        }
      }
    }
    
    return parsed;
  }

  /**
   * Enhanced module loading with example folder fetching for Terraform
   */
  protected async enhanceModuleWithExtraContent(module: AVMModule, repoURL: string): Promise<AVMModule> {
    if (!repoURL || !repoURL.includes('github.com')) {
      return module;
    }

    try {
      // Extract owner and repo from GitHub URL
      const match = repoURL.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!match) return module;

      const [, owner, repo] = match;
      
      // Fetch examples folder structure from GitHub API
      const examplesUrl = `https://api.github.com/repos/${owner}/${repo}/contents/examples`;
      const response = await fetch(examplesUrl, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'AVM-MCP-Server'
        }
      });

      if (!response.ok) return module;

      const folders = await response.json();
      
      // Only process directories
      const exampleFolders = folders
        .filter((item: any) => item.type === 'dir')
        .map((folder: any) => ({
          name: folder.name,
          path: folder.path,
          readmeUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/${folder.path}/README.md`
        }));

      // Fetch README for each example folder
      for (const folder of exampleFolders) {
        try {
          const readmeResponse = await fetch(folder.readmeUrl);
          if (readmeResponse.ok) {
            const readmeContent = await readmeResponse.text();
            const parsedExample = this.parseDocumentation(readmeContent);
            
            // Add to module examples with folder context
            if (parsedExample.examples.length > 0 || parsedExample.codeBlocks.length > 0) {
              if (!module.parsedMarkdown) {
                module.parsedMarkdown = this.parseDocumentation('');
              }
              
              // Add examples with folder name prefix
              parsedExample.examples.forEach(example => {
                module.parsedMarkdown!.examples.push({
                  ...example,
                  title: `${folder.name}: ${example.title || 'Example'}`
                });
              });
              
              // Add code blocks if no explicit examples
              if (parsedExample.examples.length === 0 && parsedExample.codeBlocks.length > 0) {
                parsedExample.codeBlocks.forEach(block => {
                  if (block.language === 'hcl' || block.language === 'terraform') {
                    module.parsedMarkdown!.examples.push({
                      title: `${folder.name}: Example`,
                      code: block.code,
                      language: block.language
                    });
                  }
                });
              }
            }
          }
        } catch (err) {
          // Continue with other folders if one fails
          continue;
        }
      }
    } catch (error) {
      // Return module unchanged if enhancement fails
      console.error(`Failed to enhance module ${module.moduleName}:`, error);
    }

    return module;
  }
}