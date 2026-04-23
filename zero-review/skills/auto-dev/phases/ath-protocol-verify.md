---
id: ath-protocol-verify
name: ATH Protocol Verification
inputs: [implementation, contracts/ath-protocol.md]
outputs: [protocol compliance report]
optional: true
---

# Phase: ATH Protocol Verification

## Purpose
Verify that an implementation correctly follows the ATH Protocol v0.1 specification. This phase runs after implementation and before general verification when the task involves ATH protocol endpoints, client usage, or server handlers.

## When to Use

- Building an ATH gateway or native service
- Implementing ATH client integration (registration, authorization, token exchange)
- Modifying attestation, scope intersection, or token validation logic
- Adding or changing proxy behavior
- Any work touching `@ath-protocol/client`, `@ath-protocol/server`, or `@ath-protocol/types`

## Process

### 1. Endpoint Compliance

For each implemented endpoint, verify against `contracts/ath-protocol.md`:

| Check | What to verify |
|-------|----------------|
| Method + path | Matches the spec exactly (e.g. `POST /ath/agents/register`, not `/register`) |
| Required fields | All required fields in request/response are present |
| Field types | Types match schema (string, array, enum values) |
| Error codes | Returns the correct ATH error code for each failure case |
| HTTP status | Status codes match spec (201 for registration, 302 for callback, etc.) |

### 2. Attestation Compliance

```
□ Algorithm is ES256 (reject all others)
□ JWT includes all required claims: iss, sub, aud, iat, exp, jti
□ iss and sub both equal agent_id
□ aud matches expected audience:
  - Base URL for register/authorize
  - Full token endpoint URL for token exchange
□ jti is unique per attestation (UUID or equivalent)
□ exp is reasonable (typically 1 hour)
□ Verification fetches identity document from agent_id URI
□ Public key extraction handles JWK format
□ Replay protection checks jti against cache
□ iat validated within 5-minute window
```

### 3. PKCE Compliance

```
□ Authorization generates PKCE code_verifier and code_challenge
□ code_challenge_method is S256 (not plain)
□ code_verifier stored in session, not exposed to agent
□ Token endpoint validates PKCE on code exchange with upstream provider
```

### 4. Scope Intersection Compliance

```
□ Effective = Agent Approved ∩ User Consented ∩ Requested
□ Empty intersection results in 403 (no token issued)
□ TokenResponse includes full scope_intersection breakdown
□ Proxy enforces effective scopes on each request
```

### 5. Session Lifecycle

```
□ ath_session_id generated on authorize
□ Session expires after configurable timeout (max 10 minutes)
□ Session is single-use (consumed on token exchange, then deleted)
□ Session bound to client_id (other agents cannot use it)
□ Failed OAuth callback updates session status, does not delete
```

### 6. Token Security

```
□ ATH tokens are opaque (not JWTs themselves)
□ Tokens bound to (agent_id, user_id, provider_id, scopes)
□ X-ATH-Agent-ID header validated on proxy requests
□ Provider tokens never exposed to agents or users
□ Revoked tokens rejected immediately
□ Expired tokens rejected based on expires_at
```

### 7. Redirect URI Validation

```
□ If redirect_uris provided at registration, user_redirect_uri must exact-match
□ If redirect_uris omitted, user_redirect_uri in authorize must be rejected
□ If redirect_uris empty array, user_redirect_uri must be rejected
□ OAuth redirect_uri always points to implementor's callback (not agent's)
```

### 8. Client API Correctness (if implementing client)

```
□ discover() fetches correct well-known endpoint per mode
□ register() sends all required fields, stores client_id + client_secret
□ authorize() generates 128-bit state from CSPRNG
□ exchangeToken() sets attestation aud to full token endpoint URL
□ proxy()/api() includes Authorization: Bearer and X-ATH-Agent-ID headers
□ revoke() sends client_id + client_secret + token
□ Error responses parsed into ATHClientError with correct code
```

## Quality Gate

- Every applicable check above passes
- No attestation JWT uses an algorithm other than ES256
- No endpoint returns a non-spec error code
- Scope intersection is computed identically to `Effective = Agent Approved ∩ User Consented ∩ Requested`
- Provider tokens are confirmed server-side only

## Skip Conditions

- Task does not involve ATH protocol endpoints or types
- Pure UI work with no protocol layer changes
