import type { AVMModule, ParsedMarkdown } from "../types.js";
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

  protected mapRowToModule(row: string[], markdown: string, _parsed?: ParsedMarkdown): AVMModule {
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
      parsedMarkdown: undefined,
      providerType: 'terraform'
    };
  }

  protected parseDocumentation(_markdownContent: string): ParsedMarkdown {
    // Terraform docs are not parsed into the rich structure yet; return empty parsed structure
    return {
      sections: [],
      codeBlocks: [],
      parameters: [],
      examples: [],
      resourceTypes: [],
      outputs: []
    };
  }
} 