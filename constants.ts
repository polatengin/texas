export const SERVER_NAME = "AVM MCP Server (Bicep & Terraform)";
export const SERVER_VERSION = "0.1.0";

export const MODULES_BATCH_SIZE = 20;
export const MODULES_BATCH_DELAY_MS = 100;

export const FETCH_RETRY_MAX = 3;
export const FETCH_RETRY_BACKOFF_BASE_MS = 1000; // ms

// Bicep-specific sources
export const BICEP_CSV_URL = "https://raw.githubusercontent.com/Azure/Azure-Verified-Modules/refs/heads/main/docs/static/module-indexes/BicepResourceModules.csv";
export const BICEP_DOCS_BASE_URL = "https://github.com/Azure/bicep-registry-modules/tree/main";

// Terraform-specific sources
export const TERRAFORM_CSV_URL = "https://raw.githubusercontent.com/Azure/Azure-Verified-Modules/refs/heads/main/docs/static/module-indexes/TerraformResourceModules.csv";
// Prefer Terraform registry doc page when available; else fallback to repo README
export const TERRAFORM_DOC_PREFERENCE: Array<'registry' | 'repo'> = ['registry', 'repo'];

// Parsing helpers
export const BR_PUBLIC_PREFIX = "br/public:"; 