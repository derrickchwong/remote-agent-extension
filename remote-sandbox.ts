/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

const server = new McpServer({
  name: 'async-remote-agent',
  version: '0.0.1',
});

// Configuration file path
const configPath = path.join(process.env.HOME || '', '.config', 'gemini-remote-sandbox', 'config.json');

interface SandboxConfig {
  proxyUrl?: string;
  username?: string;
  namespace?: string;
  kubeconfig?: string;
  defaultImage?: string;
  defaultPort?: number;
}

// Load configuration
async function loadConfig(): Promise<SandboxConfig> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    // Return defaults if config doesn't exist
    return {
      username: 'default',
      namespace: 'default',
      defaultImage: 'sandbox-runtime:latest',
      defaultPort: 8888,
    };
  }
}

// Execute kubectl command
async function kubectl(args: string[], config?: SandboxConfig): Promise<string> {
  const kubeconfigFlag = config?.kubeconfig ? `--kubeconfig=${config.kubeconfig}` : '';
  const namespaceFlag = config?.namespace ? `-n ${config.namespace}` : '';
  const cmd = `kubectl ${kubeconfigFlag} ${namespaceFlag} ${args.join(' ')}`;

  try {
    const { stdout, stderr } = await execAsync(cmd);
    // Ignore stderr warnings
    return stdout.trim();
  } catch (error: any) {
    throw new Error(`kubectl command failed: ${error.message}\nCommand: ${cmd}`);
  }
}

// Create sandbox YAML
function generateSandboxYAML(name: string, image: string, port: number, username: string): string {
  return `apiVersion: agents.x-k8s.io/v1alpha1
kind: Sandbox
metadata:
  name: ${name}
  labels:
    user: ${username}
spec:
  podTemplate:
    metadata:
      labels:
        sandbox: ${name}
        managed-by: gemini-cli
    spec:
      containers:
      - name: sandbox-runtime
        image: ${image}
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: ${port}
        env:
        - name: GOOGLE_GENAI_USE_VERTEXAI
          value: "true"
        - name: GOOGLE_CLOUD_PROJECT
          value: "agent-sandbox-476202"
        - name: GOOGLE_CLOUD_LOCATION
          value: "global"
`;
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
      const sandboxImage = image || config.defaultImage || 'sandbox-runtime:latest';
      const sandboxPort = port || config.defaultPort || 8888;
      const username = config.username || 'default';

      // Generate YAML
      const yaml = generateSandboxYAML(name, sandboxImage, sandboxPort, username);

      // Create temporary file for YAML
      const tmpFile = `/tmp/sandbox-${name}-${Date.now()}.yaml`;
      await fs.writeFile(tmpFile, yaml);

      // Apply the sandbox
      await kubectl(['apply', '-f', tmpFile], config);

      // Clean up temp file
      await fs.unlink(tmpFile);

      // Wait for the sandbox to be created and ready
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Get the status
      const status = await kubectl(['get', 'sandbox', name, '-o', 'json'], config);
      const sandboxData = JSON.parse(status);

      // Configure Gemini CLI with MCP server settings
      if (config.proxyUrl) {
        try {
          const url = `${config.proxyUrl}/${username}/${name}/v1/shell/exec`;
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

          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: settingsCommand }),
          });
        } catch (e) {
          // Ignore errors in settings configuration
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Sandbox '${name}' created successfully`,
              sandbox: {
                name: sandboxData.metadata.name,
                namespace: sandboxData.metadata.namespace,
                serviceFQDN: sandboxData.status?.serviceFQDN || 'pending',
                ready: sandboxData.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True',
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

      // Get sandbox details
      const output = await kubectl(['get', 'sandbox', name, '-o', 'json'], config);
      const sandbox = JSON.parse(output);

      // Get pod status
      const podSelector = sandbox.status?.selector || `sandbox=${name}`;
      let podStatus = 'unknown';
      let podName = 'unknown';

      try {
        const podOutput = await kubectl(['get', 'pods', '-l', podSelector, '-o', 'json'], config);
        const pods = JSON.parse(podOutput);
        if (pods.items && pods.items.length > 0) {
          const pod = pods.items[0];
          podName = pod.metadata.name;
          podStatus = pod.status.phase;
        }
      } catch (e) {
        // Ignore pod status errors
      }

      const ready = sandbox.status?.conditions?.find((c: any) => c.type === 'Ready');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              name: sandbox.metadata.name,
              namespace: sandbox.metadata.namespace,
              serviceFQDN: sandbox.status?.serviceFQDN || 'pending',
              service: sandbox.status?.service || 'pending',
              replicas: sandbox.status?.replicas || 0,
              ready: ready?.status === 'True',
              readyReason: ready?.reason,
              readyMessage: ready?.message,
              podName,
              podStatus,
              createdAt: sandbox.metadata.creationTimestamp,
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

      const output = await kubectl(['get', 'sandboxes', '-o', 'json'], config);
      const sandboxList = JSON.parse(output);

      const sandboxes = sandboxList.items.map((sb: any) => ({
        name: sb.metadata.name,
        namespace: sb.metadata.namespace,
        serviceFQDN: sb.status?.serviceFQDN || 'pending',
        ready: sb.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True',
        createdAt: sb.metadata.creationTimestamp,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              count: sandboxes.length,
              sandboxes,
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

      await kubectl(['delete', 'sandbox', name], config);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Sandbox '${name}' deleted successfully`,
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

const transport = new StdioServerTransport();
await server.connect(transport);
