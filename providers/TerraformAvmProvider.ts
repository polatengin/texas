import { marked } from "marked";
import type { AVMModule, ParsedMarkdown, MarkdownSection } from "../types.js";
import { AbstractAvmProvider } from "./AbstractAvmProvider.js";
import { TERRAFORM_CSV_URL, TERRAFORM_DOC_PREFERENCE } from "../constants.js";

export class TerraformAvmProvider extends AbstractAvmProvider {
  protected getIndexCsvUrl(): string {
    return TERRAFORM_CSV_URL;
  }

  protected shouldIncludeRow(row: string[]): boolean {
    // Column 6 is ModuleStatus; skip Proposed and Orphaned
    const status = (row[6] || "").toLowerCase();
    return status === "available";
  }

  protected getRepoUrlFromRow(row: string[]): string {
    // Column 7 is RepoURL
    return row[7] || "";
  }

  protected getModuleNameFromRow(row: string[], fallbackIndex: number): string {
    // Column 4 is ModuleName
    return row[4] || `module-${fallbackIndex}`;
  }

  public getDocumentationUrl(module: AVMModule): string {
    // Prefer Terraform registry docs if available (publicRegistryReference), else repo README fallback
    const registryUrl = module.publicRegistryReference;
    const repoReadme = module.repoURL ? `${module.repoURL}/README.md` : "";

    for (const pref of TERRAFORM_DOC_PREFERENCE) {
      if (pref === 'registry' && registryUrl) return registryUrl;
      if (pref === 'repo' && repoReadme) return repoReadme;
    }
    return registryUrl || repoReadme || "";
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
    
    let currentSection: MarkdownSection | null = null;
    let currentSectionContent = '';
    
    // Patterns for Terraform-specific parsing
    const resourceTypeRegex = /resource\s+"([^"]+)"\s+"[^"]+"/g;
    const terraformVersionRegex = /terraform\s*{\s*required_version\s*=\s*"([^"]+)"/i;
    
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
        const language = token.lang || 'hcl';
        const code = token.text;
        
        parsed.codeBlocks.push({
          language: language,
          code: code,
          context: currentSection?.title
        });
        
        // Check if it's an example based on section context or language
        if (currentSection && (
          currentSection.title.toLowerCase().includes('example') ||
          currentSection.title.toLowerCase().includes('usage') ||
          currentSection.title.toLowerCase().includes('basic') ||
          currentSection.title.toLowerCase().includes('quick start') ||
          currentSection.title.toLowerCase().includes('getting started') ||
          language === 'hcl' ||
          language === 'terraform'
        )) {
          parsed.examples.push({
            title: currentSection.title,
            code: code,
            language: language
          });
        }
        
        currentSectionContent += `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
      } else if (token.type === 'paragraph' || token.type === 'text') {
        const text = token.text || '';
        currentSectionContent += text + '\n\n';
        
        // Extract description from first paragraph if not set
        if (!parsed.description && currentSection?.level === 1) {
          parsed.description = text.substring(0, 200) + (text.length > 200 ? '...' : '');
        }
        
        // Extract resource types from Terraform resource blocks
        let resourceMatch;
        while ((resourceMatch = resourceTypeRegex.exec(text)) !== null) {
          parsed.resourceTypes.push({
            type: resourceMatch[1],
            apiVersion: undefined,
            reference: undefined
          });
        }
      } else if (token.type === 'table') {
        // Parse tables for inputs/outputs
        const headers = (token as any).header.map((h: any) => h.text.toLowerCase());
        
        for (const row of (token as any).rows) {
          const rowData: Record<string, string> = {};
          headers.forEach((header: string, index: number) => {
            rowData[header] = row[index]?.text || '';
          });
          
          // Check if this is an inputs/variables table
          if (headers.includes('name') && headers.includes('description') && 
              currentSection?.title.toLowerCase().includes('input')) {
            parsed.parameters.push({
              name: rowData.name || '',
              type: rowData.type || undefined,
              required: rowData.required === 'Yes' || rowData.required === 'true' || !rowData.default,
              defaultValue: rowData.default || undefined,
              description: rowData.description || undefined
            });
          }
          
          // Check if this is an outputs table
          if (headers.includes('name') && headers.includes('description') && 
              currentSection?.title.toLowerCase().includes('output')) {
            parsed.outputs.push({
              name: rowData.name || '',
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
      s.title.toLowerCase().includes('example') ||
      s.title.toLowerCase().includes('quick start') ||
      s.title.toLowerCase().includes('getting started')
    );
    if (usageSection) {
      parsed.usageInstructions = usageSection.content;
    }
    
    return parsed;
  }

  protected async enhanceModuleWithExtraContent(module: AVMModule, repoURL: string): Promise<AVMModule> {
    if (!repoURL || !module.parsedMarkdown) {
      return module;
    }

    try {
      const exampleFolders = await this.fetchExampleFolders(repoURL);
      if (exampleFolders.length > 0) {
        module.parsedMarkdown.exampleFolders = exampleFolders;
        
        // Add examples from example folders to the main examples array
        exampleFolders.forEach(folder => {
          if (folder.parsedContent?.examples) {
            folder.parsedContent.examples.forEach(example => {
              module.parsedMarkdown!.examples.push({
                ...example,
                source: 'example-folder',
                folderName: folder.name
              });
            });
          }
        });
      }
    } catch (error) {
      console.warn(`Failed to fetch example folders for ${repoURL}:`, error);
    }

    return module;
  }

  private async fetchExampleFolders(repoURL: string): Promise<Array<{
    name: string;
    readmeContent?: string;
    parsedContent?: ParsedMarkdown;
  }>> {
    if (!repoURL.includes('github.com')) {
      return [];
    }

    try {
      // Extract owner and repo from URL
      const match = repoURL.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!match) return [];
      
      const [, owner, repo] = match;
      
      // Get examples folder contents
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/examples`;
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        return [];
      }
      
      const contents = await response.json();
      const folders = contents.filter((item: any) => item.type === 'dir');
      
      // Fetch README from each example folder
      const folderPromises = folders.map(async (folder: any) => {
        try {
          const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/examples/${folder.name}/README.md`;
          const readmeResponse = await fetch(readmeUrl);
          
          if (readmeResponse.ok) {
            const readmeContent = await readmeResponse.text();
            const parsedContent = this.parseDocumentation(readmeContent);
            
            return {
              name: folder.name,
              readmeContent,
              parsedContent
            };
          }
        } catch (error) {
          console.warn(`Failed to fetch README for example folder ${folder.name}:`, error);
        }
        
        return {
          name: folder.name
        };
      });
      
      return await Promise.all(folderPromises);
    } catch (error) {
      console.warn(`Failed to fetch example folders from ${repoURL}:`, error);
      return [];
    }
  }
} 