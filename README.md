# AVM MCP Server

## Why do we need MCP servers?

Model Context Protocol (MCP) servers provide a standardized way for tools and AI agents to discover, query, and interact with resource templates, documentation, and automation modules. In the context of Azure Verified Modules (AVM), an MCP server enables programmatic access to module documentation and metadata, making it easier to build automation, generate architectures, and integrate with AI-driven workflows. MCP servers abstract the complexity of searching, matching, and retrieving module information, allowing clients to focus on higher-level tasks.

## How is the AVM MCP server implemented in this repository?

This repository implements an AVM MCP server using Node.js and Express, exposing an HTTP endpoint at `/mcp`. The server provides the following key features:

- **Documentation Aggregation:**
  - The `generate-docs.sh` script clones the official AVM Bicep registry modules repository, extracts all `README.md` files, and stores them in the local `docs/` directory. Each documentation file is prefixed with its GitHub URL for traceability.

- **Resource Discovery and Matching:**
  - The server loads all available documentation files and exposes a `list_avms` resource to enumerate all documented AVM modules.
  - It implements fuzzy matching logic to map user queries (e.g., "storage account") to the best-matching AVM documentation, even if the names are not exact matches.

- **Resource Details and Metadata Extraction:**
  - For each AVM documentation file, the server parses out key metadata such as resource type, API version, and constructs a suggested Bicep Registry (BR) endpoint.
  - The `get_avm_details` resource returns the full documentation and extracted metadata for a given AVM module.

- **AI/Automation Integration:**
  - The `mcp_find_avms` tool allows clients (including AI agents) to search for AVM modules by resource type and receive structured metadata and documentation links.
  - The `generate_architecture` tool collects documentation and metadata for a set of requested resources, enabling downstream tools or agents to generate Bicep architectures or provide recommendations.

- **MCP Protocol Compliance:**
  - The server uses the `@modelcontextprotocol/sdk` to implement the MCP protocol, ensuring compatibility with clients and tools that speak MCP.

This design enables seamless integration of AVM documentation into AI-driven workflows, infrastructure automation, and developer tools, making it easier to discover, use, and reason about Azure Bicep modules programmatically.

## How to run the AVM MCP server

1. **Clone the Repository:**

```bash
git clone https://github.com/your-username/your-repo.git
cd your-repo
```

1. **Install Dependencies:**

Ensure you have Node.js installed, then run:

```bash
npm install
```

1. **Generate Documentation:**

Run the script to clone the AVM Bicep registry and generate documentation:

```bash
./generate-docs.sh
```

1. **Start the Server:**

Start the MCP server using:

```bash
npm start
```

1. **Access the MCP Endpoint:**

The server will be available at `http://localhost:3000/mcp`.

## Example Usage

```text
generate infrastructure architecture in a bicep file using avm modules, I want a storage account, a redis and two vms, please
```
