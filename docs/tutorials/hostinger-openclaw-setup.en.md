# Setting Up OpenClaw Gateway on Hostinger VPS

A tutorial for installing the OpenClaw AI agent gateway on a Hostinger VPS to integrate with DeskRPG.

## Prerequisites

- Hostinger VPS (KVM2 or higher recommended, RAM 4GB+)
- SSH access to the VPS
- Docker installed (pre-installed on Hostinger VPS)

## Step 1: SSH into the VPS

```bash
ssh root@<VPS-IP>
```

## Step 2: Create Project Directory

```bash
mkdir -p /docker/openclaw/openclaw-data
mkdir -p /docker/openclaw/workspace
cd /docker/openclaw
```

## Step 3: Generate Gateway Token

```bash
# Generate a random token
export GATEWAY_TOKEN=$(openssl rand -hex 16)
echo "Your gateway token: $GATEWAY_TOKEN"
# Save this token in a secure place!
```

## Step 4: Create openclaw.json Configuration

```bash
cat > openclaw-data/openclaw.json << EOF
{
  "agents": {
    "list": [
      {
        "id": "main",
        "name": "main"
      }
    ],
    "defaults": {
      "model": {
        "primary": "openai-codex/gpt-5.4"
      }
    }
  },
  "gateway": {
    "mode": "local",
    "bind": "lan",
    "port": 18789,
    "auth": {
      "mode": "token",
      "token": "$GATEWAY_TOKEN"
    },
    "controlUi": {
      "dangerouslyDisableDeviceAuth": true,
      "allowInsecureAuth": true
    },
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  },
  "browser": {
    "headless": true,
    "noSandbox": true
  },
  "commands": {
    "bash": true,
    "native": "auto"
  }
}
EOF
```

### Configuration Reference

| Setting | Value | Description |
|---------|-------|-------------|
| `gateway.mode` | `"local"` | Run gateway in local mode |
| `gateway.bind` | `"lan"` | Bind to LAN interface (required for Docker port forwarding) |
| `gateway.port` | `18789` | Gateway listen port |
| `gateway.auth.token` | Generated token | API/WebSocket authentication token |
| `controlUi.dangerouslyDisableDeviceAuth` | `true` | Disable device pairing for server-to-server connections |
| `controlUi.allowInsecureAuth` | `true` | Allow HTTP (non-HTTPS) connections |
| `http.endpoints.chatCompletions` | `enabled: true` | Enable HTTP API (optional, WebSocket is default) |

> **Security Note:** `dangerouslyDisableDeviceAuth` is an official OpenClaw configuration option. It is required for server-to-server communication (DeskRPG → OpenClaw) without device pairing, using token authentication only. There are no security concerns as long as the token is managed securely.

## Step 5: Create docker-compose.yml

```bash
cat > docker-compose.yml << 'EOF'
services:
  openclaw:
    image: ghcr.io/openclaw/openclaw:latest
    container_name: openclaw
    restart: unless-stopped
    ports:
      - "18789:18789"
    volumes:
      - ./openclaw-data:/home/node/.openclaw
      - ./workspace:/workspace
    environment:
      - OPENCLAW_CONFIG_PATH=/home/node/.openclaw/openclaw.json
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:18789/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
EOF
```

> **Important:** Always use the official image `ghcr.io/openclaw/openclaw:latest`. The Hostinger 1-click image (`ghcr.io/hostinger/hvps-openclaw`) has internal proxy issues that cause unstable external WebSocket connections.

## Step 6: Set File Permissions

The official OpenClaw image runs as the `node` user (UID 1000):

```bash
chown -R 1000:1000 openclaw-data workspace
```

## Step 7: Start the Container

```bash
docker compose pull
docker compose up -d
```

## Step 8: Verify Status

```bash
# Check container status (should show "healthy")
docker ps

# Check logs — look for "listening on ws://..." message
docker logs openclaw --tail 10

# Test the API
curl http://localhost:18789/healthz
# Response: {"ok":true,"status":"live"}
```

## Step 9: Open Firewall Port

Add port 18789 to the firewall rules in Hostinger hPanel.

Or via CLI:

```bash
ufw allow 18789/tcp
```

## Step 10: Connect from DeskRPG

In DeskRPG Channel Settings → AI Gateway tab:

| Field | Value |
|-------|-------|
| **Gateway URL** | `http://<VPS-IP>:18789` |
| **Gateway Token** | The token generated in Step 3 |

Click "Test Connection" to verify, then "Save Gateway" to save.

## LLM Model Configuration

OpenClaw supports various LLM providers. Add them to the `models` section in `openclaw.json`:

### OpenAI Codex (Default)

Uses OpenClaw's built-in OAuth authentication. Set up during first run via `openclaw onboard`, or copy an existing `auth-profiles.json`:

```bash
# Run onboarding inside the container
docker exec -it openclaw openclaw onboard
```

### Custom Provider (e.g., Nexos AI)

```json
{
  "models": {
    "providers": {
      "nexos": {
        "baseUrl": "https://api.nexos.ai/v1",
        "apiKey": "your-api-key",
        "api": "openai-completions",
        "auth": "api-key",
        "models": [
          {
            "id": "model-id",
            "name": "Model Name",
            "maxTokens": 8192,
            "contextWindow": 200000
          }
        ]
      }
    }
  }
}
```

## HTTPS Setup (Optional)

If you have a Traefik reverse proxy, add labels to `docker-compose.yml`:

```yaml
services:
  openclaw:
    # ... existing config ...
    labels:
      - traefik.enable=true
      - traefik.http.routers.openclaw.rule=Host(`openclaw.yourdomain.com`)
      - traefik.http.routers.openclaw.entrypoints=websecure
      - traefik.http.routers.openclaw.tls.certresolver=letsencrypt
      - traefik.http.services.openclaw.loadbalancer.server.port=18789
```

In this case, set the DeskRPG Gateway URL to `https://openclaw.yourdomain.com`.

> **With HTTPS:** You can set `dangerouslyDisableDeviceAuth` to `false` and remove `allowInsecureAuth`. Browser-based device pairing works correctly in HTTPS secure contexts. However, for server-to-server communication (DeskRPG), `true` is still required.

## Troubleshooting

### "Gateway not connected" Error

1. Verify the container is running: `docker ps`
2. Check healthz response: `curl http://<VPS-IP>:18789/healthz`
3. Confirm port 18789 is open in the firewall
4. Check DeskRPG logs: `docker logs deskrpg-app --tail 20`

### "origin not allowed" Error

Automatically handled in DeskRPG v2026.3.24+. For earlier versions, add the DeskRPG server URL to `controlUi.allowedOrigins` in `openclaw.json`.

### "device identity required" Error

Verify the following settings exist in `openclaw.json`:
```json
"controlUi": {
  "dangerouslyDisableDeviceAuth": true,
  "allowInsecureAuth": true
}
```

### Container Stuck in Crash Loop

```bash
# Check logs
docker logs openclaw --tail 30

# If it's a permissions issue
chown -R 1000:1000 /docker/openclaw/openclaw-data /docker/openclaw/workspace

# If it's a configuration issue
docker exec openclaw openclaw doctor --fix
```

## Connection Summary

| Field | Value |
|-------|-------|
| Image | `ghcr.io/openclaw/openclaw:latest` |
| Port | `18789` |
| Auth | Bearer Token |
| Protocol | WebSocket (ws:// or wss://) |
| DeskRPG URL Format | `http://<VPS-IP>:18789` |
