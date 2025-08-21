import type { AVMModule, ParsedMarkdown } from "../types.js";

export abstract class AbstractAvmProvider {
  protected abstract getIndexCsvUrl(): string;
  protected abstract shouldIncludeRow(row: string[]): boolean;
  protected abstract getRepoUrlFromRow(row: string[]): string;
  protected abstract getModuleNameFromRow(row: string[], fallbackIndex: number): string;
  protected abstract mapRowToModule(row: string[], markdown: string, parsed?: ParsedMarkdown): AVMModule;
  protected abstract parseDocumentation(markdownContent: string): ParsedMarkdown;

  /**
   * Transform repository URL to README URL. Must be implemented by subclasses.
   */
  protected abstract getReadmeUrl(repoURL: string): string;

  public abstract getDocumentationUrl(module: AVMModule): string;

  /**
   * Enhanced module loading with extra content. Override in subclasses as needed.
   * Default implementation returns the module unchanged.
   */
  protected async enhanceModuleWithExtraContent(module: AVMModule, repoURL: string): Promise<AVMModule> {
    return module;
  }

  protected parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
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
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  protected async fetchMarkdownWithRetry(
    url: string,
    maxRetries = 3
  ): Promise<{ content: string; status: string }> {
    if (!url) {
      return { content: "", status: "no-url" };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const content = await response.text();
          return { content, status: "success" };
        }
        if (response.status === 404) {
          return { content: "", status: "404" };
        }
        if (response.status === 403) {
          return { content: "", status: "rate-limited" };
        }
        return { content: "", status: `http-${response.status}` };
      } catch (error) {
        if (attempt === maxRetries) {
          return { content: "", status: "network-error" };
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
    return { content: "", status: "unknown-error" };
  }

  public async loadAllModules(): Promise<AVMModule[]> {
    const response = await fetch(this.getIndexCsvUrl());
    const csvData = await response.text();
    const lines = csvData.split("\n").filter((line) => line.trim());

    const modulePromises: Promise<AVMModule>[] = [];
    const fetchStats = {
      success: 0,
      notFound: 0,
      rateLimited: 0,
      networkError: 0,
      noUrl: 0,
      other: 0,
    };

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i]);

      if (!this.shouldIncludeRow(values)) {
        continue;
      }

      const repoURL = this.getRepoUrlFromRow(values);
      const moduleName = this.getModuleNameFromRow(values, i);

      const modulePromise = (async (): Promise<AVMModule> => {
        let markdownContent = "";
        let fetchStatus = "no-url";

        if (repoURL) {
          const readmeURL = this.getReadmeUrl(repoURL);
          const result = await this.fetchMarkdownWithRetry(readmeURL);
          markdownContent = result.content;
          fetchStatus = result.status;
        }

        switch (fetchStatus) {
          case "success":
            fetchStats.success++;
            break;
          case "404":
            fetchStats.notFound++;
            break;
          case "rate-limited":
            fetchStats.rateLimited++;
            break;
          case "network-error":
            fetchStats.networkError++;
            break;
          case "no-url":
            fetchStats.noUrl++;
            break;
          default:
            fetchStats.other++;
            break;
        }

        const parsedMarkdown = markdownContent ? this.parseDocumentation(markdownContent) : undefined;
        let module = this.mapRowToModule(values, markdownContent, parsedMarkdown);

        // Allow subclasses to enhance the module with additional content
        module = await this.enhanceModuleWithExtraContent(module, repoURL);

        return module;
      })();

      modulePromises.push(modulePromise);
    }

    const batchSize = 20;
    const modules: AVMModule[] = [];

    for (let i = 0; i < modulePromises.length; i += batchSize) {
      const batch = modulePromises.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch);

      batchResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          modules.push(result.value);
        } else {
          const values = this.parseCsvLine(lines[i + index + 1]);
          modules.push(this.mapRowToModule(values, "", undefined));
        }
      });

      if (i + batchSize < modulePromises.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return modules;
  }
}
