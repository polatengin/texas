import type { AVMModule, ParsedMarkdown } from "../types.js";
import { MODULES_BATCH_SIZE, MODULES_BATCH_DELAY_MS, FETCH_RETRY_MAX, FETCH_RETRY_BACKOFF_BASE_MS } from "../constants.js";

export abstract class AbstractAvmProvider {
  protected abstract getIndexCsvUrl(): string;
  protected abstract shouldIncludeRow(row: string[]): boolean;
  protected abstract getRepoUrlFromRow(row: string[]): string;
  protected abstract getModuleNameFromRow(row: string[], fallbackIndex: number): string;
  protected abstract mapRowToModule(row: string[], markdown: string, parsed?: ParsedMarkdown): AVMModule;
  protected abstract parseDocumentation(markdownContent: string): ParsedMarkdown;
  public abstract getDocumentationUrl(module: AVMModule): string;

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
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  protected async fetchMarkdownWithRetry(url: string, maxRetries: number = FETCH_RETRY_MAX): Promise<{ content: string; status: string }> {
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
      } catch (_error) {
        if (attempt === maxRetries) {
          return { content: "", status: "network-error" };
        }
        await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_BACKOFF_BASE_MS * attempt));
      }
    }
    return { content: "", status: "unknown-error" };
  }

  public async loadAllModules(): Promise<AVMModule[]> {
    const response = await fetch(this.getIndexCsvUrl());
    const csvData = await response.text();

    const lines = csvData.split('\n').filter(line => line.trim());

    const modulePromises: Promise<AVMModule>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i]);

      if (!this.shouldIncludeRow(values)) {
        continue;
      }

      const repoURL = this.getRepoUrlFromRow(values);
      const moduleName = this.getModuleNameFromRow(values, i);

      const modulePromise = (async (): Promise<AVMModule> => {
        let markdownContent = "";
        if (repoURL) {
          const readmeURL = `${repoURL}/README.md`;
          const result = await this.fetchMarkdownWithRetry(readmeURL);
          markdownContent = result.content;
        }

        const parsed = markdownContent ? this.parseDocumentation(markdownContent) : undefined;
        return this.mapRowToModule(values, markdownContent, parsed);
      })();

      modulePromises.push(modulePromise);
    }

    const batchSize = MODULES_BATCH_SIZE;
    const modules: AVMModule[] = [];

    for (let i = 0; i < modulePromises.length; i += batchSize) {
      const batch = modulePromises.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch);

      batchResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          modules.push(result.value);
        } else {
          const values = this.parseCsvLine(lines[i + index + 1]);
          modules.push(this.mapRowToModule(values, ""));
        }
      });

      if (i + batchSize < modulePromises.length) {
        await new Promise(resolve => setTimeout(resolve, MODULES_BATCH_DELAY_MS));
      }
    }

    return modules;
  }
} 