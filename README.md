# Async Remote Agent Extension for Gemini CLI

This Gemini CLI extension allows you to manage remote agent sandboxes on a GKE cluster with [agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox) installed.

## Features

- **Create sandboxes**: Create isolated agent runtime environments on your GKE cluster
- **Check status**: Monitor the status of your sandboxes
- **Execute commands**: Send prompts/commands to sandboxes and get results
- **List sandboxes**: View all sandboxes in your cluster
- **Delete sandboxes**: Clean up sandboxes when done

## Prerequisites

1. A GKE cluster with [agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox) installed
2. The sandbox proxy deployed on your GKE cluster (see `~/workspaces/remote-agent-sandbox-proxy`)
3. `kubectl` configured to access your GKE cluster
4. Node.js and npm installed
5. Gemini CLI installed

## Installation

1. Clone or download this extension:
   ```bash
   cd /path/to/async-remote-agent-extension
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Link the extension to Gemini CLI:
   ```bash
   gemini extensions link .
   ```

## Configuration

Create a configuration file at `~/.config/gemini-remote-sandbox/config.json`:

```bash
mkdir -p ~/.config/gemini-remote-sandbox
cp config.template.json ~/.config/gemini-remote-sandbox/config.json
```

Edit the config file with your settings:

```json
{
  "proxyUrl": "http://35.123.45.67",
  "username": "alice",
  "namespace": "default",
  "kubeconfig": "/path/to/your/gke/kubeconfig",
  "defaultImage": "sandbox-runtime:latest",
  "defaultPort": 8888
}
```

Configuration options:
- `proxyUrl`: **REQUIRED** - URL of the sandbox proxy LoadBalancer (get this from `kubectl get service sandbox-proxy`)
- `username`: Username for sandbox routing (default: "default"). Sandboxes must have a `user` label matching this value.
- `namespace`: Kubernetes namespace where sandboxes will be created (default: "default")
- `kubeconfig`: Path to your kubeconfig file (optional, uses default kubectl config if not specified)
- `defaultImage`: Default container image for sandboxes (default: "sandbox-runtime:latest")
- `defaultPort`: Default port for the sandbox API (default: 8888)

## Usage

After linking the extension, restart your Gemini CLI session. The following commands and tools will be available:

### Commands

#### `/remote:create <sandbox-name>`

Creates a new sandbox on your GKE cluster.

Example:
```
/remote:create my-sandbox
```

#### `/remote:status <sandbox-name>`

Gets the status of a sandbox.

Example:
```
/remote:status my-sandbox
```

#### `/remote:prompt <sandbox-name> <command>`

Executes a command in the sandbox and returns the results.

Example:
```
/remote:prompt my-sandbox ls -la
```

### Tools

The extension also provides MCP tools that can be used directly:

- `create_sandbox`: Creates a new sandbox
- `get_sandbox_status`: Gets sandbox status
- `send_prompt_to_sandbox`: Sends a command to the sandbox
- `list_sandboxes`: Lists all sandboxes
- `delete_sandbox`: Deletes a sandbox

You can invoke these tools by asking Gemini to use them:
```
List all my sandboxes
```
```
Delete the sandbox named test-sandbox
```

## Building Your Sandbox Image

To use this extension, you need a container image that runs the sandbox runtime API. You can use the example from agent-sandbox:

1. Navigate to the python-runtime-sandbox example:
   ```bash
   cd ~/workspaces/agent-sandbox/examples/python-runtime-sandbox
   ```

2. Build the image:
   ```bash
   docker build -t sandbox-runtime:latest .
   ```

3. Push to your container registry:
   ```bash
   docker tag sandbox-runtime:latest gcr.io/your-project/sandbox-runtime:latest
   docker push gcr.io/your-project/sandbox-runtime:latest
   ```

4. Update your config.json to use the pushed image:
   ```json
   {
     "defaultImage": "gcr.io/your-project/sandbox-runtime:latest"
   }
   ```

## How It Works

This extension uses the agent-sandbox Kubernetes CRD to create isolated sandbox environments. Each sandbox:

1. Runs as a Kubernetes pod in your GKE cluster
2. Exposes a FastAPI server with endpoints for executing commands
3. Provides isolation using your cluster's configured runtime (e.g., gVisor)
4. Can persist data using PersistentVolumeClaims

### Network Connectivity

The extension communicates with sandboxes through a proxy service deployed in your GKE cluster:

```
Gemini CLI (local workstation)
    ↓ HTTP request to proxy LoadBalancer
Sandbox Proxy (GKE with public IP)
    ↓ routes based on path: /{username}/{sandboxname}/*
Sandbox Pods (internal Kubernetes services)
```

1. When you send a command with `/remote:prompt my-sandbox ls -la`, the extension:
   - Makes an HTTP POST request to `http://PROXY_IP/alice/my-sandbox/execute`
   - The proxy discovers sandboxes via the Kubernetes API and routes to the correct pod
   - Returns the results (stdout, stderr, exit code)

**Benefits:**
- ✅ Fast - no port-forwarding overhead
- ✅ Simple - just HTTP requests
- ✅ Scalable - proxy can handle many concurrent requests
- ✅ Secure - only the proxy needs a public IP, sandboxes remain internal

**Setup:**
The proxy service is in `~/workspaces/remote-agent-sandbox-proxy`. Deploy it to your GKE cluster and configure the LoadBalancer IP in this extension's config.

## Troubleshooting

### "kubectl command not found"
Make sure kubectl is installed and in your PATH.

### "Sandbox not ready"
Wait a few seconds for the sandbox pod to start. You can check the status with `/remote:status <name>`.

### "Failed to execute command"
Ensure your sandbox image includes the FastAPI runtime server as shown in the agent-sandbox examples.

### Permission denied errors
Make sure your kubeconfig has the necessary permissions to create and manage Sandbox resources in the specified namespace.

## Development

To make changes to the extension:

1. Edit the TypeScript source files
2. Rebuild:
   ```bash
   npm run build
   ```
3. Restart Gemini CLI to pick up the changes

## License

Apache-2.0
