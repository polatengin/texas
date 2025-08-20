# AVM MCP Server

## Why do we need MCP servers?

Model Context Protocol (MCP) servers provide a standardized way for tools and AI agents to discover, query, and interact with resource templates, documentation, and automation modules. In the context of Azure Verified Modules (AVM), an MCP server enables programmatic access to module documentation and metadata, making it easier to build automation, generate architectures, and integrate with AI-driven workflows. MCP servers abstract the complexity of searching, matching, and retrieving module information, allowing clients to focus on higher-level tasks.

## How is the AVM MCP server implemented in this repository?

This repository implements an AVM MCP server using Node.js and TypeScript with the official Model Context Protocol SDK. The server operates as a stdio-based MCP server and provides the following key features:

- **Real-time CSV Data Fetching:**
  - Fetches the official AVM Bicep registry module index directly from the Azure Verified Modules repository CSV file
  - Filters out "Proposed" status modules to include only available modules
  - Processes 170+ verified AVM modules with parallel markdown fetching for optimal performance

- **Dynamic Documentation Retrieval:**
  - Automatically fetches README.md documentation for each AVM module from GitHub
  - Uses parallel processing with batching (20 modules per batch) for fast startup
  - Implements retry logic with exponential backoff for reliable documentation fetching
  - Provides detailed fetch statistics and error handling

- **MCP Resources:**
  - **`list_avms`**: Lists all available AVM modules with their display names and module paths
  - **`get_avm_details/{moduleName}`**: Returns comprehensive module details including metadata, documentation, and parsed information

- **MCP Tools:**
  - **`mcp_find_avms`**: Searches for AVM modules by resource type with fuzzy matching across module names, alternative names, and resource types
  - **`generate_architecture`**: Collects comprehensive documentation for multiple resource types to enable AI-driven Bicep architecture generation

- **Intelligent Parsing:**
  - Extracts resource types, API versions, and Bicep Registry (BR) endpoints from module documentation
  - Constructs GitHub documentation URLs for each module
  - Provides structured metadata for easy consumption by AI agents and automation tools

- **MCP Protocol Compliance:**
  - Uses the official `@modelcontextprotocol/sdk` for full MCP compatibility
  - Operates over stdio transport for seamless integration with MCP clients
  - Supports both resource discovery and tool-based interactions

This design enables seamless integration of real-time AVM documentation into AI-driven workflows, infrastructure automation, and developer tools, making it easier to discover, use, and reason about Azure Bicep modules programmatically.

## How to run the AVM MCP server locally

### Prerequisites

- **Node.js:** Ensure you have Node.js (version 18 or higher) installed
- **npm:** Node Package Manager (comes with Node.js)

### Option 1: Install from npm (Recommended)

The easiest way to use the AVM MCP server is to install it directly from npm:

```bash
# Install globally
npm install -g @polatengin/texas

# Run the server
texas
```

### Option 1b: Use with npx (No Installation Required)

You can also run the server directly with npx without installing it globally:

```bash
# Run directly with npx
npx @polatengin/texas
```

This is particularly useful for:
- **MCP Client Integration**: Direct execution in MCP server configurations
- **CI/CD Pipelines**: Running without permanent installation
- **Testing**: Trying the latest version without committing to installation

### Option 2: Run from source

If you want to run from source or contribute to the project:

**Clone the Repository:**
```bash
git clone https://github.com/polatengin/texas
cd texas
```

**Install Dependencies:**
```bash
npm install
```

**Build the Project:**
```bash
npm run build
```

**Start the Server:**
```bash
npm start
```

### Server Startup Process

When you start the server, it will:

1. **Fetch AVM Module Index**: Downloads the latest CSV index from Azure Verified Modules repository
2. **Filter Modules**: Excludes "Proposed" status modules (keeps ~170 available modules)
3. **Fetch Documentation**: Downloads README.md files for each module in parallel batches
4. **Start MCP Server**: Begins listening for MCP connections over stdio

The initial startup takes about 30-60 seconds as it fetches documentation for all modules.

### Using the MCP Server

The server operates over stdio and is designed to be used by MCP clients. It doesn't provide an HTTP endpoint but instead communicates using the Model Context Protocol over standard input/output.

**Available MCP Resources:**
- `list_avms` - Lists all available AVM modules
- `get_avm_details/{moduleName}` - Get detailed information about a specific module

**Available MCP Tools:**
- `mcp_find_avms` - Search for modules by resource type
- `generate_architecture` - Generate architecture documentation for multiple resources

## Add AVM MCP Server to VS Code

To use the AVM MCP server with GitHub Copilot in Visual Studio Code, you need to configure it in your workspace's MCP settings.

### Quick Setup with npx (Recommended)

The simplest way to integrate the texas server is using npx, which requires no prior installation:

Create or update `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "texas": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "@polatengin/texas"
      ]
    }
  }
}
```

**Benefits of the npx approach:**
- ✅ **No installation required** - npx downloads and runs the latest version automatically
- ✅ **Always up-to-date** - Uses the latest published version from npm
- ✅ **Zero maintenance** - No need to manually update the package
- ✅ **Clean environment** - Doesn't clutter your global npm packages

### Alternative Setup Options

#### Option 1: Using globally installed package

If you prefer to install the package globally first:

```bash
npm install -g @polatengin/texas
```

Then configure `.vscode/mcp.json`:

```json
{
  "servers": {
    "texas": {
      "type": "stdio",
      "command": "texas"
    }
  }
}
```

#### Option 2: Using local development version

If you're running from source, configure `.vscode/mcp.json` as:

```json
{
  "servers": {
    "local-dev": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js"]
    }
  }
}
```

### Using with GitHub Copilot

1. **Open VS Code** and ensure GitHub Copilot extension is installed
2. **Toggle Chat**: Click the "Toggle Chat" button or use `Ctrl+Shift+I`
3. **Switch to Agent Mode**: Change from "Ask" mode to "Agent" mode
4. **Select Tools**: Click "Select Tools" and then "Add More Tools"
5. **Choose AVM MCP Server**: Select the configured MCP server from the list

### Verifying the Connection

The MCP server will start automatically when VS Code connects to it. You should see startup logs indicating:
- CSV data fetching
- Module documentation retrieval
- Server ready status

### Performance Note

The first connection may take 30-60 seconds as the server fetches documentation for ~170 AVM modules. Subsequent operations will be fast as the data is cached in memory.

## Example Usage

Once configured with GitHub Copilot in VS Code, you can use natural language to interact with Azure Verified Modules:

### Basic Module Discovery
```text
List all available AVM storage modules
```

### Architecture Generation
```text
Generate infrastructure architecture in a Bicep file using AVM modules, I want a storage account, a Redis cache and two VMs, please
```

```text
I want a Bicep file that uses AVM modules to create a Storage Account on Azure
```

### Specific Module Information
```text
Show me details about the storage account AVM module including parameters and examples
```

### Multi-Resource Architectures
```text
Create a Bicep template using AVM modules for:
- Storage account with blob containers
- Key Vault for secrets
- App Service with managed identity
- Application Insights for monitoring
```

### Module Search and Comparison
```text
Find AVM modules for container hosting and compare their features
```

The MCP server will automatically:
- Search for relevant AVM modules based on your requirements
- Provide detailed documentation and examples
- Generate suggested Bicep code using proper AVM module references
- Include best practices and parameter configurations

## Installation & Publishing

### Installing the Package

```bash
# Global installation (recommended for CLI usage)
npm install -g @polatengin/texas

# Local installation (for programmatic usage)
npm install @polatengin/texas
```

### Package Information

- **Package Name**: `@polatengin/texas`
- **Current Version**: `0.0.2`
- **Registry**: [npm registry](https://www.npmjs.com/package/@polatengin/texas)
- **License**: MIT
- **Repository**: [GitHub](https://github.com/polatengin/texas)

### Automated Publishing

This project uses GitHub Actions for automated publishing to npm with:
- Manual workflow triggering for controlled releases
- Automatic patch version incrementing
- Trusted Publisher (OIDC) authentication for secure publishing
- Provenance attestation for supply chain security
