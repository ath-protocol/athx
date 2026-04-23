# ATHX — Headless CLI Client for the ATH Protocol

[中文](./README.md)

> ⚡ Command-line client for the ATH trust ecosystem — agent registration, authorization, token exchange, and API proxy access

## 🎯 Overview

ATHX is a TypeScript CLI client for the [Agent Trust Handshake (ATH) Protocol](https://github.com/ath-protocol/agent-trust-handshake-protocol) v0.1, supporting both gateway mode and native mode. It includes the complete ATH protocol SDK (`@ath-protocol/types`, `@ath-protocol/client`, `@ath-protocol/server`) and the [zero-review](https://github.com/A7um/zero-review) automated development skill plugin.

ATHX handles the full trusted handshake flow: agent identity attestation (ES256 JWT proof), two-phase authorization (app-side registration + user-side OAuth/PKCE), token exchange (with three-way scope intersection), and protected API access.

## ✨ Core Capabilities

### 🔐 Agent Identity Attestation
- ES256 JWT attestation signing and verification
- Automatic agent identity document fetching and public key extraction
- JTI replay protection to prevent attestation reuse
- `iat` time-window validation (within 5 minutes)

### 🤝 Two-Phase Trusted Handshake
- **Phase A (App-Side Authorization)**: Agent registration, scope approval, client credential issuance
- **Phase B (User-Side Authorization)**: OAuth authorization, mandatory PKCE S256, user consent flow
- Session management (single-use, 10-minute timeout)
- Redirect URI exact-match validation

### 🎫 Token Management
- ATH access token creation, validation, and revocation
- Token binding: `(agent_id, user_id, provider_id, scopes)`
- Scope intersection: `Effective = Agent Approved ∩ User Consented ∩ Requested`
- Empty intersection results in token denial (403)

### 🚦 Gateway Proxy
- `ANY /ath/proxy/{provider_id}/{path}` — token validation and upstream forwarding
- `X-ATH-Agent-ID` header enforcement (must match token-bound agent_id)
- Upstream provider OAuth tokens never exposed to agents
- Hop-by-hop and ATH-specific headers stripped before forwarding

### 📝 Service Discovery
- Gateway mode: `GET /.well-known/ath.json` — lists available providers and scopes
- Native mode: `GET /.well-known/ath-app.json` — service endpoints and OAuth config

## 📦 Installation

### npm
```bash
npm install -g athx
```

### From Source
```bash
git clone https://github.com/ath-protocol/athx.git
cd athx
pnpm install
pnpm run build
```

## 🚀 Quick Start

### Step 1: Discover Available Providers
```bash
# Gateway mode
athx discover --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json

# Native mode
athx discover --mode native --service https://api.example.com --agent-id https://my-agent.example.com/.well-known/agent.json
```

### Step 2: Register the Agent (Phase A)
```bash
athx register --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json \
  --provider github --scopes repo,read:user --purpose "Code review assistant"
```

### Step 3: Authorize the User (Phase B)
```bash
athx authorize --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json \
  --provider github --scopes repo,read:user
# Output includes authorization URL — open in browser for OAuth consent
```

### Step 4: Exchange Token
```bash
athx token --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json \
  --code <auth-code> --session <session-id>
```

### Step 5: Access the API
```bash
athx proxy --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json \
  github GET /user/repos
```

### Step 6: Revoke the Token
```bash
athx revoke --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json \
  --provider github
```

## 🏗️ Architecture
```
┌─────────────────┐
│   athx CLI      │  CLI commands (discover, register, authorize, token, proxy, revoke, status, config)
├─────────────────┤
│ ATHXGatewayClient │  Gateway mode — proxies requests through ATH gateway
│ ATHXNativeClient  │  Native mode — connects directly to ATH-native services
├─────────────────┤
│ @ath-protocol/  │
│   client        │  ATH client SDK (attestation, register, authorize, token exchange, proxy)
│   server        │  ATH server SDK (handlers, proxy, token validation, scope intersection)
│   types         │  ATH protocol types (auto-generated from JSON Schema)
├─────────────────┤
│ zero-review/    │  Automated dev skill plugin (auto-dev, auto-test, auto-req, auto-triage)
└─────────────────┘
```

### ATH Protocol Endpoints

| Endpoint | Method | Path |
|----------|--------|------|
| Gateway Discovery | GET | `/.well-known/ath.json` |
| Service Discovery | GET | `/.well-known/ath-app.json` |
| Agent Registration | POST | `/ath/agents/register` |
| Initiate Authorization | POST | `/ath/authorize` |
| OAuth Callback | GET | `/ath/callback` |
| Token Exchange | POST | `/ath/token` |
| API Proxy | ANY | `/ath/proxy/{provider_id}/{path}` |
| Token Revocation | POST | `/ath/revoke` |

### ATH Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| INVALID_ATTESTATION | 401 | JWT verification failed |
| AGENT_NOT_REGISTERED | 403 | Unknown client_id |
| AGENT_UNAPPROVED | 403 | Registration pending or denied |
| PROVIDER_NOT_APPROVED | 403 | Agent not approved for provider |
| SCOPE_NOT_APPROVED | 403 | Requested scopes exceed approval |
| SESSION_NOT_FOUND | 400 | Invalid ath_session_id |
| SESSION_EXPIRED | 400 | Session past 10-minute limit |
| STATE_MISMATCH | 400 | CSRF state mismatch |
| TOKEN_INVALID | 401 | Token not found |
| TOKEN_EXPIRED | 401 | Token past expiry |
| TOKEN_REVOKED | 401 | Token explicitly revoked |
| AGENT_IDENTITY_MISMATCH | 403 | X-ATH-Agent-ID doesn't match token |
| PROVIDER_MISMATCH | 403 | Token not valid for requested provider |
| USER_DENIED | 403 | User denied OAuth consent |
| OAUTH_ERROR | 502 | Upstream OAuth failure |
| INTERNAL_ERROR | 500 | Server error |

## 🎯 Who This Is For
- 🤖 AI agent developers
- 🔐 Security engineers
- 🏗️ System architects
- 👷‍♂️ Platform operations engineers

## 📖 Documentation
- [ATH Protocol Specification v0.1](https://github.com/ath-protocol/agent-trust-handshake-protocol/tree/main/specification/0.1)
- [TypeScript SDK](https://github.com/ath-protocol/typescript-sdk)
- [ATH Protocol Website](https://athprotocol.dev)
- [zero-review Skill Plugin](https://github.com/A7um/zero-review)

## 🧪 Testing

```bash
pnpm install
pnpm run build
pnpm run test    # 62 tests (36 unit + 26 E2E)
```

E2E tests follow the auto-test `ath-protocol` persona — only the external OAuth provider is mocked. All ATH protocol logic is tested via real HTTP: gateway handlers, proxy validation, token binding, PKCE, scope intersection, and session management.

### E2E Test Coverage

| Category | Tests | What's Tested |
|----------|-------|---------------|
| Gateway happy path | 7 | discover → register → authorize → consent → token → proxy → revoke |
| Gateway error scenarios | 5 | SCOPE_NOT_APPROVED, SESSION_NOT_FOUND, PROVIDER_MISMATCH, TOKEN_REVOKED, TOKEN_INVALID, AGENT_IDENTITY_MISMATCH |
| Gateway scope intersection | 2 | Effective = approved ∩ consented ∩ requested; partial scope subset |
| Gateway PKCE | 2 | S256 code_challenge present; full chain validates end-to-end |
| Native happy path | 8 | discover → register → authorize → consent → token → api → revoke |
| Native error scenarios | 2 | SCOPE_NOT_APPROVED, SESSION_NOT_FOUND |

## 📄 License
This project is licensed under the **MIT License** — see the LICENSE file for details.
