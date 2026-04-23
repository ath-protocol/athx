# Contract: ATH Protocol Reference

Reference contract for the Agent Trust Handshake (ATH) Protocol v0.1. All skills that build, test, or triage ATH-aware software must align with these definitions.

**Consumers:** `auto-dev`, `auto-test`, `auto-triage`

## Protocol Version

```yaml
ath_version: "0.1"
```

## Endpoints

```yaml
discovery:
  method: GET
  path: /.well-known/ath.json
  mode: gateway

service_discovery:
  method: GET
  path: /.well-known/ath-app.json
  mode: native

register:
  method: POST
  path: /ath/agents/register
  phase: A (app-side authorization)

get_agent:
  method: GET
  path: /ath/agents/{clientId}

authorize:
  method: POST
  path: /ath/authorize
  phase: B (user-side authorization)

callback:
  method: GET
  path: /ath/callback

token:
  method: POST
  path: /ath/token

proxy:
  method: ANY
  path: /ath/proxy/{provider_id}/{path}
  mode: gateway

revoke:
  method: POST
  path: /ath/revoke
```

## Two-Phase Trust Handshake

### Phase A — Registration (App-Side Authorization)

```yaml
request: AgentRegistrationRequest
  agent_id: string (URI)              # Agent's canonical identity URI
  agent_attestation: string (JWT)     # ES256 signed JWT with iss, sub, aud, iat, exp, jti
  developer:
    name: string
    id: string
    contact: string (email, optional)
  requested_providers:                # min 1 item
    - provider_id: string
      scopes: [string]
  purpose: string (optional)
  redirect_uris: [string] (optional)  # If omitted, user_redirect_uri rejected at authorize

response: AgentRegistrationResponse
  client_id: string
  client_secret: string               # Store securely
  agent_status: approved | pending | denied
  approved_providers:
    - provider_id: string
      approved_scopes: [string]
      denied_scopes: [string]
      denial_reason: string (optional)
  approval_expires: string (ISO 8601)
```

### Phase B — Authorization (User-Side Authorization)

```yaml
request: AuthorizationRequest
  client_id: string
  agent_attestation: string (JWT)     # Fresh attestation
  provider_id: string
  scopes: [string]                    # Must be within agent's approved scopes
  state: string                       # CSPRNG, >=128 bits entropy
  user_redirect_uri: string (optional)
  resource: string (optional, RFC 8707)

response: AuthorizationResponse
  authorization_url: string           # Includes PKCE code_challenge + S256
  ath_session_id: string              # Max 10 minutes, single-use
```

### Token Exchange

```yaml
request: TokenExchangeRequest
  grant_type: authorization_code
  client_id: string
  client_secret: string
  agent_attestation: string (JWT)     # aud MUST be token endpoint URL
  code: string                        # OAuth authorization code from callback
  ath_session_id: string

response: TokenResponse
  access_token: string                # Bound to (agent_id, user_id, provider_id, scopes)
  token_type: Bearer
  expires_in: number (seconds)
  effective_scopes: [string]
  provider_id: string
  agent_id: string
  scope_intersection:
    agent_approved: [string]          # Phase A approved scopes
    user_consented: [string]          # Phase B consented scopes
    effective: [string]               # Intersection of all three
```

### Proxy (Gateway Mode)

```yaml
request:
  method: ANY
  path: /ath/proxy/{provider_id}/{path}
  headers:
    Authorization: Bearer <ath_token>
    X-ATH-Agent-ID: <agent_id>       # Must match token's bound agent_id

behavior:
  - Validate ATH bearer token (expiry, revocation, scope, binding)
  - Verify X-ATH-Agent-ID matches token's agent_id
  - Resolve upstream URL for provider_id
  - Forward with provider's OAuth token (never expose to agent)
  - Strip hop-by-hop headers and ATH-specific headers before forwarding
```

### Token Revocation

```yaml
request: TokenRevocationRequest
  token: string
  client_id: string (optional, required for agent-initiated)
  client_secret: string (optional, required for agent-initiated)
```

## Agent Attestation (JWT)

```yaml
algorithm: ES256
header:
  alg: ES256
  kid: <key-id>
payload:
  iss: <agent_id>                     # Agent's canonical URI
  sub: <agent_id>                     # Same as iss
  aud: <target_url>                   # Gateway/service URL (or token endpoint for token exchange)
  iat: <issued_at>
  exp: <expiration>                   # Typically 1 hour
  jti: <unique_id>                    # UUID, replay protection
  capabilities: [string] (optional)

verification_steps:
  1. Fetch agent identity document from agent_id URI
  2. Extract public key (JWK)
  3. Verify JWT signature (ES256)
  4. Validate exp (not expired)
  5. Validate aud (matches expected audience)
  6. Check jti replay cache (reject duplicates until exp)
  7. Validate iat within 5 minutes of current time
  8. Identity document cache TTL <= 5 minutes
```

## Scope Intersection

```
Effective = Agent Approved ∩ User Consented ∩ Requested
```

If the intersection is empty, no token is issued.

## Error Codes

```yaml
error_codes:
  - INVALID_ATTESTATION       # 401 — JWT verification failed
  - AGENT_NOT_REGISTERED      # 403 — Unknown client_id
  - AGENT_UNAPPROVED          # 403 — Registration pending/denied
  - PROVIDER_NOT_APPROVED     # 403 — Agent not approved for provider
  - SCOPE_NOT_APPROVED        # 403 — Requested scopes exceed approval
  - SESSION_NOT_FOUND         # 400 — Invalid ath_session_id
  - SESSION_EXPIRED           # 400 — Session past 10-minute limit
  - STATE_MISMATCH            # 400 — CSRF state mismatch
  - TOKEN_INVALID             # 401 — Token not found
  - TOKEN_EXPIRED             # 401 — Token past expiry
  - TOKEN_REVOKED             # 401 — Token explicitly revoked
  - AGENT_IDENTITY_MISMATCH   # 403 — X-ATH-Agent-ID doesn't match token
  - PROVIDER_MISMATCH         # 403 — Token not valid for requested provider
  - USER_DENIED               # 403 — User denied OAuth consent
  - OAUTH_ERROR               # 502 — Upstream OAuth failure
  - INTERNAL_ERROR            # 500 — Server error
```

## SDK Reference (TypeScript)

```yaml
client_classes:
  - ATHGatewayClient           # Gateway mode: discover → register → authorize → exchangeToken → proxy
  - ATHNativeClient            # Native mode: discover → register → authorize → exchangeToken → api

server_modules:
  - createATHHandlers          # Framework-agnostic request handlers
  - createProxyHandler         # Gateway proxy with token validation
  - createServiceDiscoveryDocument  # Native mode discovery builder
  - verifyAttestation          # JWT attestation verification
  - intersectScopes            # Scope intersection computation
  - validateToken              # Token validation (expiry, revocation, binding)

stores:
  - InMemoryAgentRegistry      # Agent registration storage
  - InMemoryTokenStore         # ATH access token storage
  - InMemorySessionStore       # Authorization session storage
  - InMemoryProviderTokenStore # Upstream OAuth token storage (server-only, never exposed)
```

## Rules

- Agent attestation JWTs use ES256 exclusively. No other algorithm is accepted.
- Every attestation must include a unique `jti`. Replayed `jti` values must be rejected.
- Token exchange attestation `aud` must be the full token endpoint URL, not the base URL.
- PKCE with S256 is mandatory for all OAuth authorization flows.
- Upstream provider tokens must never be exposed to agents or users.
- The `X-ATH-Agent-ID` header must match the token's bound `agent_id` on every proxy request.
- `ath_session_id` is single-use and expires after 10 minutes maximum.
- Scope intersection that produces an empty set must result in token denial (403).
