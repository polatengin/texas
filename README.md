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

## How to run the AVM MCP server locally

- **Prerequisites:**

Ensure you have the Node.js (version 23 or higher) installed.

- **Clone the Repository:**

```bash
git clone https://github.com/polatengin/texas

cd texas
```

- **Install Dependencies:**

Ensure you have Node.js installed, then run:

```bash
npm install
```

- **Generate Documentation:**

Run the script to clone the AVM Bicep registry and generate documentation:

```bash
./generate-docs.sh
```

- **Start the Server:**

Start the MCP server using:

```bash
npm start
```

- **Access the MCP Endpoint:**

The server will be available at `http://localhost:3000/mcp`.

## How to deploy the AVM MCP server to Azure Container Instances

To deploy the AVM MCP server to Azure Container Instances, follow these steps:

### Prerequisites

- **Azure CLI:** Ensure you have the Azure CLI installed and configured with your Azure account.

- **Docker:** Ensure you have Docker installed to build the container image.

### Steps to Deploy

Generate random prefix for the resources so that they will be uniqu;

```bash
export RANDOM_PREFIX=$(openssl rand -hex 4)
```

Use the Azure CLI to create a resource group:

```bash
az group create --name "${RANDOM_PREFIX}-texas-rg" --location "westus"
```

Create an Azure Container Registry to store the MCP server image:

```bash
az acr create --resource-group "${RANDOM_PREFIX}-texas-rg" --name "${RANDOM_PREFIX}texasacr" --location westus --sku Basic --admin-enabled true
```

Generate the new tag for the Docker image:

```bash
export TAG="v$(date +%Y%m%d%H%M%S)"
```

Build the Docker image and push it to the Azure Container Registry:

```bash
docker build -t "${RANDOM_PREFIX}texasacr.azurecr.io/avm-mcp-server:${TAG}" .
docker push "${RANDOM_PREFIX}texasacr.azurecr.io/avm-mcp-server:${TAG}"
```

Create an Azure Container Instance using the pushed image:

```bash
az container create --resource-group "${RANDOM_PREFIX}-texas-rg" --name "${RANDOM_PREFIX}-texas-app" --image "${RANDOM_PREFIX}texasacr.azurecr.io/avm-mcp-server:${TAG}" --registry-login-server "${RANDOM_PREFIX}texasacr.azurecr.io" --registry-username "${RANDOM_PREFIX}texasacr" --registry-password $(az acr credential show --name "${RANDOM_PREFIX}texasacr" --query passwords[0].value -o tsv) --ports 3000 --protocol TCP --location westus --cpu 1 --memory 1.5 --dns-name-label "avm-mcp-server-$(date +%s)" --restart-policy Always --environment-variables NODE_ENV=production
```

After the container is running, we can test access the MCP server using the following command:

```bash
curl "http://$(az container show --resource-group "${RANDOM_PREFIX}-texas-rg" --name "${RANDOM_PREFIX}-texas-app" --query "ipAddress.fqdn" -o tsv):3000/health"
```

## Example Usage

```text
Generate infrastructure architecture in a Bicep file using AVM modules, I want a storage account, a Redis and two VMs, please
```
