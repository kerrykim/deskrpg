# Hostinger VPS에서 OpenClaw 게이트웨이 설정 가이드

OpenTown과 연동할 OpenClaw AI 에이전트 게이트웨이를 Hostinger VPS에 설치하는 튜토리얼입니다.

## 사전 준비

- Hostinger VPS (KVM2 이상 권장, RAM 4GB+)
- VPS에 SSH 접속 가능
- Docker 설치 완료 (Hostinger VPS는 기본 설치됨)

## 1단계: VPS에 SSH 접속

```bash
ssh root@<VPS-IP>
```

## 2단계: 프로젝트 디렉토리 생성

```bash
mkdir -p /docker/openclaw/openclaw-data
mkdir -p /docker/openclaw/workspace
cd /docker/openclaw
```

## 3단계: 게이트웨이 토큰 생성

```bash
# 랜덤 토큰 생성
export GATEWAY_TOKEN=$(openssl rand -hex 16)
echo "Your gateway token: $GATEWAY_TOKEN"
# 이 토큰을 안전한 곳에 저장하세요!
```

## 4단계: openclaw.json 설정 파일 생성

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

### 설정 항목 설명

| 설정 | 값 | 설명 |
|------|-----|------|
| `gateway.mode` | `"local"` | 로컬 모드로 게이트웨이 실행 |
| `gateway.bind` | `"lan"` | LAN 인터페이스에 바인딩 (Docker 포트 포워딩에 필요) |
| `gateway.port` | `18789` | 게이트웨이 리슨 포트 |
| `gateway.auth.token` | 생성한 토큰 | API/WebSocket 인증 토큰 |
| `controlUi.dangerouslyDisableDeviceAuth` | `true` | 외부 서버 연결 시 device pairing 비활성화 |
| `controlUi.allowInsecureAuth` | `true` | HTTP(non-HTTPS) 연결 허용 |
| `http.endpoints.chatCompletions` | `enabled: true` | HTTP API 활성화 (선택사항, WebSocket이 기본) |

> **보안 참고:** `dangerouslyDisableDeviceAuth`는 OpenClaw 공식 설정 옵션입니다. 서버 간 통신(OpenTown → OpenClaw)에서 device pairing 없이 토큰 인증만으로 연결하기 위해 필요합니다. 토큰이 안전하게 관리되면 보안 문제가 없습니다.

## 5단계: docker-compose.yml 생성

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

> **중요:** 반드시 공식 이미지 `ghcr.io/openclaw/openclaw:latest`를 사용하세요. Hostinger 1-click 이미지(`ghcr.io/hostinger/hvps-openclaw`)는 내부 프록시 문제로 외부 WebSocket 연결이 불안정합니다.

## 6단계: 파일 권한 설정

공식 OpenClaw 이미지는 `node` 유저(UID 1000)로 실행됩니다:

```bash
chown -R 1000:1000 openclaw-data workspace
```

## 7단계: 컨테이너 시작

```bash
docker compose pull
docker compose up -d
```

## 8단계: 상태 확인

```bash
# 컨테이너 상태 확인 (healthy가 되어야 함)
docker ps

# 로그 확인 — "listening on ws://..." 메시지가 보이면 성공
docker logs openclaw --tail 10

# API 테스트
curl http://localhost:18789/healthz
# 응답: {"ok":true,"status":"live"}
```

## 9단계: 방화벽에서 포트 열기

Hostinger hPanel에서 방화벽 규칙에 포트 18789을 추가합니다.

또는 CLI로:

```bash
ufw allow 18789/tcp
```

## 10단계: OpenTown에서 연결

OpenTown 채널 설정 → AI Gateway 탭에서:

| 항목 | 값 |
|------|-----|
| **Gateway URL** | `http://<VPS-IP>:18789` |
| **Gateway Token** | 3단계에서 생성한 토큰 |

"Test Connection" 클릭하여 연결 확인 후 "Save Gateway" 저장.

## LLM 모델 설정

OpenClaw는 다양한 LLM 프로바이더를 지원합니다. `openclaw.json`의 `models` 섹션에 추가:

### OpenAI Codex (기본)

OpenClaw에 내장된 OAuth 인증을 사용합니다. 첫 실행 시 `openclaw onboard`를 통해 설정하거나, 기존 `auth-profiles.json`을 복사합니다:

```bash
# 컨테이너 내부에서 onboarding 실행
docker exec -it openclaw openclaw onboard
```

### 커스텀 프로바이더 (예: Nexos AI)

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

## HTTPS 설정 (선택사항)

Traefik 리버스 프록시가 있는 경우, `docker-compose.yml`에 라벨 추가:

```yaml
services:
  openclaw:
    # ... 기존 설정 ...
    labels:
      - traefik.enable=true
      - traefik.http.routers.openclaw.rule=Host(`openclaw.yourdomain.com`)
      - traefik.http.routers.openclaw.entrypoints=websecure
      - traefik.http.routers.openclaw.tls.certresolver=letsencrypt
      - traefik.http.services.openclaw.loadbalancer.server.port=18789
```

이 경우 OpenTown의 Gateway URL은 `https://openclaw.yourdomain.com`으로 설정합니다.

> **HTTPS 사용 시:** `dangerouslyDisableDeviceAuth`를 `false`로 변경하고, `allowInsecureAuth`를 제거해도 됩니다. HTTPS secure context에서는 브라우저 기반 device pairing이 정상 작동합니다. 단, 서버 간 통신(OpenTown)에서는 여전히 `true`가 필요합니다.

## 문제 해결

### "Gateway not connected" 에러

1. VPS에서 컨테이너 실행 중인지 확인: `docker ps`
2. healthz 응답 확인: `curl http://<VPS-IP>:18789/healthz`
3. 방화벽에서 18789 포트가 열려있는지 확인
4. OpenTown 로그 확인: `docker logs opentown-app --tail 20`

### "origin not allowed" 에러

OpenTown v2026.3.24+에서는 자동 처리됩니다. 이전 버전이면 `openclaw.json`의 `controlUi.allowedOrigins`에 OpenTown 서버 URL을 추가하세요.

### "device identity required" 에러

`openclaw.json`에 아래 설정이 있는지 확인:
```json
"controlUi": {
  "dangerouslyDisableDeviceAuth": true,
  "allowInsecureAuth": true
}
```

### 컨테이너가 crash loop에 빠지는 경우

```bash
# 로그 확인
docker logs openclaw --tail 30

# 권한 문제인 경우
chown -R 1000:1000 /docker/openclaw/openclaw-data /docker/openclaw/workspace

# 설정 문제인 경우
docker exec openclaw openclaw doctor --fix
```

## 연결 정보 요약

| 항목 | 값 |
|------|-----|
| 이미지 | `ghcr.io/openclaw/openclaw:latest` |
| 포트 | `18789` |
| 인증 | Bearer Token |
| 프로토콜 | WebSocket (ws:// 또는 wss://) |
| OpenTown URL 형식 | `http://<VPS-IP>:18789` |
