# Remote Agent Sandbox Extension

This extension allows you to manage remote agent sandboxes on Google Kubernetes Engine (GKE) with the agent-sandbox operator installed.

## Available Tools

- `create_sandbox`: Create a new agent sandbox on the GKE cluster
- `get_sandbox_status`: Get the status of an existing sandbox
- `send_prompt_to_sandbox`: Send a command/prompt to execute in the sandbox via the proxy
- `list_sandboxes`: List all sandboxes in the cluster
- `delete_sandbox`: Delete a sandbox

## Custom Commands

- `/remote:create <name>`: Create a new sandbox with the specified name
- `/remote:status <name>`: Check the status of a sandbox
- `/remote:prompt <name> <prompt>`: Execute a Gemini CLI prompt in the specified sandbox

## Configuration

Configuration file location: `~/.config/gemini-remote-sandbox/config.json`

Required fields:
- `proxyUrl`: URL of the sandbox proxy (e.g., "http://34.27.37.121")
- `username`: Your username (defaults to "default")
- `namespace`: Kubernetes namespace (defaults to "default")
- `kubeconfig`: Path to your kubeconfig file
- `defaultImage`: Default container image for sandboxes
- `defaultPort`: Default port for sandbox services (8080) 