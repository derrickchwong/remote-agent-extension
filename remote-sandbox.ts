/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

const server = new McpServer({
  name: 'async-remote-agent',
  version: '0.0.1',
});

// Configuration file path
const configPath = path.join(process.env.HOME || '', '.config', 'gemini-remote-sandbox', 'config.json');

interface SandboxConfig {
  proxyUrl: string;
  username?: string;
  namespace?: string;
  defaultImage?: string;
  defaultPort?: number;
}

// Load configuration
async function loadConfig(): Promise<SandboxConfig> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    if (!config.proxyUrl) {
      throw new Error('proxyUrl is required in config.json. Please set it to your proxy URL (e.g., http://34.27.37.121)');
    }

    return config;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Config file not found at ${configPath}. Please create it with at least a 'proxyUrl' field.`);
    }
    throw error;
  }
}

// Tool: Create a new sandbox
server.registerTool(
  'create_sandbox',
  {
    description: 'Creates a new agent sandbox on the GKE cluster',
    inputSchema: z.object({
      name: z.string().describe('Name of the sandbox to create'),
      image: z.string().optional().describe('Container image to use (defaults to config)'),
      port: z.number().optional().describe('Port to expose (defaults to 8888)'),
    }).shape,
  },
  async ({ name, image, port }) => {
    try {
      const config = await loadConfig();
      const sandboxImage = image || config.defaultImage;
      const sandboxPort = port || config.defaultPort || 8888;
      const username = config.username || 'default';
      const namespace = config.namespace || 'default';

      // Create sandbox via proxy API
      const createUrl = `${config.proxyUrl}/api/sandboxes`;
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          username,
          image: sandboxImage,
          port: sandboxPort,
          namespace,
        }),
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.json();
        throw new Error(`Failed to create sandbox: ${errorData.error || errorData.message}`);
      }

      const createData = await createResponse.json();

      // Wait for the sandbox to be ready (30 seconds)
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Get the status from proxy
      const statusUrl = `${config.proxyUrl}/api/sandboxes/${username}/${name}`;
      const statusResponse = await fetch(statusUrl);

      let sandboxData: any = {};
      if (statusResponse.ok) {
        sandboxData = await statusResponse.json();
      }

      // Configure Gemini CLI with MCP server settings in the sandbox
      try {
        const execUrl = `${config.proxyUrl}/${username}/${name}/v1/shell/exec`;
        const settingsCommand = `mkdir -p ~/.gemini && cat > ~/.gemini/settings.json << 'EOFJSON'
{
  "mcpServers": {
    "sandbox": {
      "httpUrl": "http://localhost:${sandboxPort}/mcp",
      "args": []
    }
  }
}
EOFJSON`;

        await fetch(execUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: settingsCommand }),
        });
      } catch (e) {
        // Ignore errors in settings configuration
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Sandbox '${name}' created successfully`,
              sandbox: {
                name: sandboxData.name || name,
                namespace: sandboxData.namespace || namespace,
                serviceFQDN: sandboxData.serviceFQDN || 'pending',
                ready: sandboxData.ready || false,
              },
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }, null, 2),
          },
        ],
      };
    }
  },
);

// Tool: Get sandbox status
server.registerTool(
  'get_sandbox_status',
  {
    description: 'Gets the status of an agent sandbox',
    inputSchema: z.object({
      name: z.string().describe('Name of the sandbox'),
    }).shape,
  },
  async ({ name }) => {
    try {
      const config = await loadConfig();
      const username = config.username || 'default';

      // Get sandbox status from proxy API
      const url = `${config.proxyUrl}/api/sandboxes/${username}/${name}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Sandbox '${name}' not found`);
        }
        const errorData = await response.json();
        throw new Error(`Failed to get sandbox status: ${errorData.error || errorData.message}`);
      }

      const sandbox = await response.json();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(sandbox, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }, null, 2),
          },
        ],
      };
    }
  },
);

// Tool: Send prompt to sandbox
server.registerTool(
  'send_prompt_to_sandbox',
  {
    description: 'Sends a command/prompt to the sandbox execute endpoint via the proxy',
    inputSchema: z.object({
      name: z.string().describe('Name of the sandbox'),
      command: z.string().describe('Command to execute in the sandbox'),
    }).shape,
  },
  async ({ name, command }) => {
    try {
      const config = await loadConfig();

      if (!config.proxyUrl) {
        throw new Error('proxyUrl not configured. Please set proxyUrl in config.json');
      }

      const username = config.username || 'default';
      const url = `${config.proxyUrl}/${username}/${name}/v1/shell/exec`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Proxy returned ${response.status}: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();

      // AIO sandbox returns: { success, message, data: { output, exit_code, ... } }
      const output = data.data?.output || '';
      const exitCode = data.data?.exit_code ?? -1;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: data.success,
              sandbox: name,
              command,
              result: {
                output,
                exit_code: exitCode,
                session_id: data.data?.session_id,
              },
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }, null, 2),
          },
        ],
      };
    }
  },
);

// Tool: List all sandboxes
server.registerTool(
  'list_sandboxes',
  {
    description: 'Lists all agent sandboxes in the cluster',
    inputSchema: z.object({}).shape,
  },
  async () => {
    try {
      const config = await loadConfig();

      // List sandboxes from proxy API
      const url = `${config.proxyUrl}/api/sandboxes`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to list sandboxes: ${errorData.error || errorData.message}`);
      }

      const data = await response.json();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }, null, 2),
          },
        ],
      };
    }
  },
);

// Tool: Delete sandbox
server.registerTool(
  'delete_sandbox',
  {
    description: 'Deletes an agent sandbox',
    inputSchema: z.object({
      name: z.string().describe('Name of the sandbox to delete'),
    }).shape,
  },
  async ({ name }) => {
    try {
      const config = await loadConfig();
      const username = config.username || 'default';
      const namespace = config.namespace || 'default';

      // Delete sandbox via proxy API
      const url = `${config.proxyUrl}/api/sandboxes/${username}/${name}?namespace=${namespace}`;
      const response = await fetch(url, {
        method: 'DELETE',
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Sandbox '${name}' not found`);
        }
        const errorData = await response.json();
        throw new Error(`Failed to delete sandbox: ${errorData.error || errorData.message}`);
      }

      const data = await response.json();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }, null, 2),
          },
        ],
      };
    }
  },
);

// Tool: Pause sandbox
server.registerTool(
  'pause_sandbox',
  {
    description: 'Pauses an agent sandbox by setting replicas to 0',
    inputSchema: z.object({
      name: z.string().describe('Name of the sandbox to pause'),
    }).shape,
  },
  async ({ name }) => {
    try {
      const config = await loadConfig();
      const username = config.username || 'default';
      const namespace = config.namespace || 'default';

      // Pause sandbox via proxy API
      const url = `${config.proxyUrl}/api/sandboxes/${username}/${name}/pause?namespace=${namespace}`;
      const response = await fetch(url, {
        method: 'POST',
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Sandbox '${name}' not found`);
        }
        const errorData = await response.json();
        throw new Error(`Failed to pause sandbox: ${errorData.error || errorData.message}`);
      }

      const data = await response.json();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }, null, 2),
          },
        ],
      };
    }
  },
);

// Tool: Resume sandbox
server.registerTool(
  'resume_sandbox',
  {
    description: 'Resumes a paused agent sandbox by setting replicas to 1',
    inputSchema: z.object({
      name: z.string().describe('Name of the sandbox to resume'),
    }).shape,
  },
  async ({ name }) => {
    try {
      const config = await loadConfig();
      const username = config.username || 'default';
      const namespace = config.namespace || 'default';

      // Resume sandbox via proxy API
      const url = `${config.proxyUrl}/api/sandboxes/${username}/${name}/resume?namespace=${namespace}`;
      const response = await fetch(url, {
        method: 'POST',
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Sandbox '${name}' not found`);
        }
        const errorData = await response.json();
        throw new Error(`Failed to resume sandbox: ${errorData.error || errorData.message}`);
      }

      const data = await response.json();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }, null, 2),
          },
        ],
      };
    }
  },
);

// Log errors to file for debugging
process.on('uncaughtException', (error) => {
  fs.appendFile('/tmp/mcp-server-error.log', `Uncaught Exception: ${error.stack}\n`).catch(() => {});
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  fs.appendFile('/tmp/mcp-server-error.log', `Unhandled Rejection: ${reason}\n`).catch(() => {});
  process.exit(1);
});

const transport = new StdioServerTransport();
await server.connect(transport);
