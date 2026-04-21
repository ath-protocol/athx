/**
 * ATHXNativeClient — high-level ATH native-mode client with credential persistence.
 *
 * Wraps @ath-protocol/client ATHNativeClient with:
 * - Automatic credential restore from CredentialStore
 * - Token expiry awareness
 * - Discovery caching (ServiceDiscoveryDocument)
 */
import { ATHNativeClient, type ATHClientConfig } from "@ath-protocol/client";
import type {
  ServiceDiscoveryDocument,
  AgentRegistrationResponse,
  TokenResponse,
  DeveloperInfo,
  ProviderScopeRequest,
} from "@ath-protocol/types";
import { CredentialStore, type StoredToken } from "./credential-store.js";

export interface ATHXNativeClientConfig extends ATHClientConfig {
  credentialStore?: CredentialStore;
}

export class ATHXNativeClient extends ATHNativeClient {
  private store?: CredentialStore;
  private urlStr: string;
  private agentIdStr: string;
  private nativeDiscoveryCache?: ServiceDiscoveryDocument;

  constructor(config: ATHXNativeClientConfig) {
    super(config);
    this.store = config.credentialStore;
    this.urlStr = config.url.replace(/\/$/, "");
    this.agentIdStr = config.agentId;
    this.restoreCredentials();
  }

  private restoreCredentials(): void {
    if (!this.store) return;
    const creds = this.store.getCredentials(this.urlStr);
    if (creds && creds.agentId === this.agentIdStr) {
      this.setCredentials(creds.clientId, creds.clientSecret);
    }
  }

  override async discover(): Promise<ServiceDiscoveryDocument> {
    if (this.nativeDiscoveryCache) return this.nativeDiscoveryCache;
    this.nativeDiscoveryCache = await super.discover();
    return this.nativeDiscoveryCache;
  }

  override async register(options: {
    developer: DeveloperInfo;
    providers: ProviderScopeRequest[];
    purpose: string;
    redirectUris?: string[];
  }): Promise<AgentRegistrationResponse> {
    const res = await super.register(options);
    if (this.store) {
      this.store.saveRegistration(this.urlStr, this.agentIdStr, res.client_id, res.client_secret);
    }
    return res;
  }

  override async exchangeToken(code: string, sessionId: string): Promise<TokenResponse> {
    const res = await super.exchangeToken(code, sessionId);
    if (this.store) {
      const token: StoredToken = {
        accessToken: res.access_token,
        provider: res.provider_id,
        effectiveScopes: res.effective_scopes,
        expiresAt: new Date(Date.now() + res.expires_in * 1000).toISOString(),
        agentId: res.agent_id,
      };
      this.store.saveToken(this.urlStr, res.provider_id, token);
    }
    return res;
  }

  restoreToken(provider: string): boolean {
    if (!this.store) return false;
    const token = this.store.getToken(this.urlStr, provider);
    if (!token) return false;
    this.setToken(token.accessToken);
    return true;
  }

  clearDiscoveryCache(): void {
    this.nativeDiscoveryCache = undefined;
  }
}
