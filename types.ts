export interface MarkdownSection {
  title: string;
  level: number;
  content: string;
  anchor?: string;
}

export interface ParsedMarkdown {
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
    source?: string;
    folderName?: string;
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
  exampleFolders?: Array<{
    name: string;
    readmeContent?: string;
    parsedContent?: ParsedMarkdown;
  }>;
}

export interface AVMModule {
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
  providerType: 'bicep' | 'terraform';
}
