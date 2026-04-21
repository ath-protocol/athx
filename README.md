# athx

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/athx.svg)](https://nodejs.org)

Headless CLI client for the [ATH (Agent Trust Handshake) protocol](https://github.com/A7um/ATH) — supports both **gateway** and **native** deployment modes.

`athx` is to ATH what [acpx](https://github.com/openclaw/acpx) is to ACP: an opinionated client layer + CLI on top of the [official TypeScript SDK](https://github.com/ath-protocol/typescript-sdk).

## Install

```bash
npm install -g athx
```

## Gateway Mode

Connect to an ATH gateway that proxies requests to upstream service providers.

```bash
athx config set-gateway local http://localhost:3000
athx config set agent-id https://my-agent.example.com/.well-known/agent.json

athx discover
athx register --provider github --scopes repo,read:user
athx authorize --provider github --scopes repo
athx token --code AUTH_CODE --session ath_sess_xxx
athx proxy github GET /user/repos
athx revoke --provider github
```

## Native Mode

Connect directly to an ATH-native service (no gateway proxy).

```bash
athx discover --mode native --service https://mail.example.com
athx register --mode native --service https://mail.example.com --provider mail --scopes mail:read
athx authorize --mode native --service https://mail.example.com --provider mail --scopes mail:read
athx token --mode native --service https://mail.example.com --code AUTH_CODE --session ath_sess_xxx
athx proxy --mode native --service https://mail.example.com mail GET /inbox
athx revoke --mode native --service https://mail.example.com --provider mail
```

## SDK Usage

```typescript
import { ATHXGatewayClient, ATHXNativeClient, CredentialStore, Config } from "athx";
import { generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("ES256");
const config = new Config();
const store = new CredentialStore(config.getConfigDir());

// Gateway mode
const gateway = new ATHXGatewayClient({
  url: "http://localhost:3000",
  agentId: "https://my-agent.example.com/.well-known/agent.json",
  privateKey,
  credentialStore: store,
});
const providers = await gateway.discover();   // DiscoveryDocument
await gateway.register({ ... });
const auth = await gateway.authorize("github", ["repo"]);
const token = await gateway.exchangeToken(code, auth.ath_session_id);
const repos = await gateway.proxy("github", "GET", "/user/repos");
await gateway.revoke();

// Native mode
const native = new ATHXNativeClient({
  url: "https://mail.example.com",
  agentId: "https://my-agent.example.com/.well-known/agent.json",
  privateKey,
  credentialStore: store,
});
const service = await native.discover();      // ServiceDiscoveryDocument
await native.register({ ... });
const auth2 = await native.authorize("mail", ["mail:read"]);
const token2 = await native.exchangeToken(code, auth2.ath_session_id);
const inbox = await native.api("GET", "/inbox");
await native.revoke();
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `athx discover` | List providers (gateway) or service info (native) |
| `athx register` | Register agent — Phase A: app-side authorization |
| `athx authorize` | Get OAuth consent URL — Phase B: user-side |
| `athx token` | Exchange authorization code for ATH access token |
| `athx proxy <provider> <method> <path>` | API call — proxied (gateway) or direct (native) |
| `athx revoke` | Revoke current token |
| `athx status` | Show registrations and active tokens |
| `athx config show\|init\|set-gateway\|set` | Manage configuration |

### Global Options

| Flag | Description |
|------|-------------|
| `--mode gateway\|native` | Deployment mode (default: `gateway`) |
| `--gateway <url>` | Gateway URL or config name (gateway mode) |
| `--service <url>` | Service URL (native mode) |
| `--agent-id <uri>` | Agent identity URI |
| `--key <path>` | Path to ES256 private key (PEM) |
| `--format text\|json` | Output format (default: `text`) |

## Configuration

athx stores configuration in `~/.athx/`:

- `config.json` — gateway URLs, agent identity, key paths
- `credentials.json` — persisted registrations and ATH tokens (per gateway/service URL)

```bash
athx config init
athx config set-gateway production https://ath.example.com
athx config set agent-id https://my-agent.example.com/.well-known/agent.json
athx config set key-path ./keys/agent.pem
athx config show
```

## Architecture

```
athx
├── ATHXGatewayClient   → wraps @ath-protocol/client ATHGatewayClient
│   └── discover()          → GET /.well-known/ath.json
│   └── proxy()             → ANY /ath/proxy/{provider}/{path}
├── ATHXNativeClient    → wraps @ath-protocol/client ATHNativeClient
│   └── discover()          → GET /.well-known/ath-app.json
│   └── api()               → direct call to service api_base
├── CredentialStore     → ~/.athx/credentials.json
├── Config              → ~/.athx/config.json
└── CLI                 → commander-based, 8 commands
```

Both clients share: `register()`, `authorize()`, `exchangeToken()`, `revoke()`, `setCredentials()`, `setToken()`, `restoreToken()`.

## Development

This package lives in the [ATH monorepo](https://github.com/A7um/ATH). To develop:

```bash
git clone https://github.com/A7um/ATH.git
cd ATH
pnpm install

# Build SDK + athx
pnpm --filter @ath-protocol/types build
pnpm --filter @ath-protocol/client build
pnpm --filter @ath-protocol/server build
pnpm --filter athx build

# Run tests (starts gateway + mock-oauth + native service)
pnpm --filter athx test
```

## License

MIT
