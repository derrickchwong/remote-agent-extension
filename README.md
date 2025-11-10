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
  "apiKey": "sk_live_YOUR_API_KEY_HERE",
  "defaultImage": "us-central1-docker.pkg.dev/agent-sandbox-476202/agent-sandbox/sandbox-runtime:latest",
  "defaultPort": 8888
}
```

Configuration options:
- `proxyUrl`: **REQUIRED** - URL of the sandbox proxy LoadBalancer (get this with: `kubectl get service sandbox-proxy`)
- `apiKey`: **REQUIRED** - Your user API key for authentication (see Authentication Setup below)
- `defaultImage`: Default container image for sandboxes (optional)
- `defaultPort`: Default port for the sandbox API (default: 8888)

### Authentication Setup

The proxy now requires API key authentication. To get your API key:

1. **Get the admin API key** (for first-time setup):
   ```bash
   kubectl get secret admin-credentials -o jsonpath='{.data.ADMIN_API_KEY}' | base64 -d
   ```

2. **Create a user** (using admin API key):
   ```bash
   export ADMIN_API_KEY="<admin-key-from-step-1>"
   export PROXY_IP=$(kubectl get svc sandbox-proxy -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

   curl -X POST http://$PROXY_IP/api/admin/users \
     -H "Authorization: Bearer $ADMIN_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"username":"yourname","email":"your@email.com"}'
   ```

3. **Generate an API key for your user** (save the user ID from step 2):
   ```bash
   export USER_ID="<uuid-from-step-2>"

   curl -X POST http://$PROXY_IP/api/admin/users/$USER_ID/apikeys \
     -H "Authorization: Bearer $ADMIN_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"name":"Gemini CLI Extension"}'
   ```

4. **Save the API key** shown in the response to your config.json:
   ```json
   {
     "apiKey": "sk_live_abc123def456..."
   }
   ```

**Security Note**: Keep your API key secure! It provides access to all your sandboxes.

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

#### `/remote:list`

Lists all sandboxes for the authenticated user.

Example:
```
/remote:list
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
- `POST /api/sandboxes` - Create sandbox (requires authentication)
- `GET /api/sandboxes` - List user's sandboxes (requires authentication)
- `GET /api/sandboxes/:name` - Get sandbox status (requires authentication)
- `DELETE /api/sandboxes/:name` - Delete sandbox (requires authentication)
- `POST /proxy/:name/v1/shell/exec` - Execute command in sandbox (requires authentication)
- `POST /api/sandboxes/:name/pause` - Pause sandbox (requires authentication)
- `POST /api/sandboxes/:name/resume` - Resume sandbox (requires authentication)

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

### "proxyUrl is required in config.json" or "apiKey is required"
Make sure you have created the config file at `~/.config/gemini-remote-sandbox/config.json` with both `proxyUrl` and `apiKey` fields.

### "Unauthorized" / "Invalid API key"
- Verify your API key is correct in config.json
- Check that your API key hasn't expired
- Ensure you're using a user API key (starts with `sk_live_`), not the admin key
- Generate a new API key if needed (see Authentication Setup above)

### "Failed to create sandbox" / Connection errors
- Check that the proxy is running: `kubectl get deployment sandbox-proxy`
- Verify the proxy LoadBalancer IP: `kubectl get service sandbox-proxy`
- Test proxy health: `curl http://PROXY_IP/health`
- Ensure your `proxyUrl` in config.json matches the proxy's external IP
- Verify authentication is working: `curl http://PROXY_IP/api/me -H "Authorization: Bearer YOUR_API_KEY"`

### "Sandbox not ready"
Wait 30-60 seconds for the sandbox pod to start. You can check the status with `/remote:status <name>` or `/remote:list`.

### "Sandbox not found" / "Forbidden" 404/403 errors
- Verify the sandbox exists: use `/remote:list` to see your sandboxes
- Check that you own the sandbox - users can only access their own sandboxes
- Verify you're using the correct API key for your user

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
