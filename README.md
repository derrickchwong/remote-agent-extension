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
3. Node.js and npm installed
4. Gemini CLI installed

**Note:** No kubectl or kubeconfig required! All Kubernetes operations are handled by the proxy.

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
  "defaultImage": "us-central1-docker.pkg.dev/agent-sandbox-476202/agent-sandbox/sandbox-runtime:latest",
  "defaultPort": 8888
}
```

Configuration options:
- `proxyUrl`: **REQUIRED** - URL of the sandbox proxy LoadBalancer (get this with: `kubectl get service sandbox-proxy`)
- `username`: Username for sandbox routing (default: "default"). Sandboxes created will have a `user` label with this value.
- `namespace`: Kubernetes namespace where sandboxes will be created (default: "default")
- `defaultImage`: Default container image for sandboxes (optional)
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

### Architecture

The extension communicates **entirely through the proxy** - no direct Kubernetes access needed:

```
Gemini CLI Extension (local workstation)
    ↓ All operations via HTTP to proxy
Sandbox Proxy (GKE with public IP)
    ↓ Manages Kubernetes resources via k8s API
    ↓ Routes requests to sandboxes
Sandbox Pods (internal Kubernetes services)
```

**Proxy API Endpoints:**
- `POST /api/sandboxes` - Create sandbox (proxy creates k8s resources)
- `GET /api/sandboxes` - List all sandboxes
- `GET /api/sandboxes/:username/:name` - Get sandbox status
- `DELETE /api/sandboxes/:username/:name` - Delete sandbox
- `POST /:username/:name/v1/shell/exec` - Execute command in sandbox

**Benefits:**
- ✅ No kubectl required - works from anywhere with internet access
- ✅ No kubeconfig needed - proxy handles all k8s authentication
- ✅ Fast - no port-forwarding overhead
- ✅ Simple - just HTTP requests
- ✅ Scalable - proxy can handle many concurrent requests
- ✅ Secure - only proxy needs k8s access, sandboxes remain internal

**Setup:**
The proxy service is in `~/workspaces/remote-agent-sandbox-proxy`. Deploy it to your GKE cluster and configure the LoadBalancer IP in this extension's config.

## Troubleshooting

### "proxyUrl is required in config.json"
Make sure you have created the config file at `~/.config/gemini-remote-sandbox/config.json` with at least a `proxyUrl` field.

### "Failed to create sandbox" / Connection errors
- Check that the proxy is running: `kubectl get deployment sandbox-proxy`
- Verify the proxy LoadBalancer IP: `kubectl get service sandbox-proxy`
- Test proxy health: `curl http://PROXY_IP/health`
- Ensure your `proxyUrl` in config.json matches the proxy's external IP

### "Sandbox not ready"
Wait 30-60 seconds for the sandbox pod to start. You can check the status with `/remote:status <name>` or `list all sandboxes`.

### "Sandbox not found" 404 errors
- Verify the sandbox exists: ask Gemini to "list all sandboxes"
- Check that your `username` in config.json matches the sandbox's `user` label
- The proxy may need time to discover new sandboxes (30 second refresh interval)

### "Failed to execute command"
Ensure your sandbox image includes the FastAPI runtime server as shown in the agent-sandbox examples.

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
