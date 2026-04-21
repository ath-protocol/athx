/**
 * CredentialStore — persists agent registrations and ATH tokens to ~/.athx/credentials.json.
 *
 * Stored per gateway URL so agents can work with multiple gateways.
 */
import fs from "node:fs";
import path from "node:path";

export interface StoredToken {
  accessToken: string;
  provider: string;
  effectiveScopes: string[];
  expiresAt: string;
  agentId: string;
}

export interface StoredCredentials {
  clientId: string;
  clientSecret: string;
  agentId: string;
  registeredAt: string;
  tokens: Record<string, StoredToken>;
}

type StoreData = Record<string, StoredCredentials>;

export class CredentialStore {
  private storePath: string;
  private data: StoreData;

  constructor(configDir: string) {
    this.storePath = path.join(configDir, "credentials.json");
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      return JSON.parse(fs.readFileSync(this.storePath, "utf-8"));
    } catch {
      return {};
    }
  }

  private save(): void {
    const dir = path.dirname(this.storePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2) + "\n", "utf-8");
  }

  getCredentials(gatewayUrl: string): StoredCredentials | undefined {
    return this.data[gatewayUrl];
  }

  saveRegistration(gatewayUrl: string, agentId: string, clientId: string, clientSecret: string): void {
    if (!this.data[gatewayUrl]) {
      this.data[gatewayUrl] = {
        clientId,
        clientSecret,
        agentId,
        registeredAt: new Date().toISOString(),
        tokens: {},
      };
    } else {
      this.data[gatewayUrl].clientId = clientId;
      this.data[gatewayUrl].clientSecret = clientSecret;
      this.data[gatewayUrl].agentId = agentId;
    }
    this.save();
  }

  saveToken(gatewayUrl: string, provider: string, token: StoredToken): void {
    const creds = this.data[gatewayUrl];
    if (!creds) return;
    creds.tokens[provider] = token;
    this.save();
  }

  getToken(gatewayUrl: string, provider: string): StoredToken | undefined {
    const creds = this.data[gatewayUrl];
    if (!creds) return undefined;
    const token = creds.tokens[provider];
    if (!token) return undefined;
    if (new Date(token.expiresAt) < new Date()) {
      delete creds.tokens[provider];
      this.save();
      return undefined;
    }
    return token;
  }

  removeToken(gatewayUrl: string, provider: string): void {
    const creds = this.data[gatewayUrl];
    if (!creds) return;
    delete creds.tokens[provider];
    this.save();
  }

  clear(gatewayUrl: string): void {
    delete this.data[gatewayUrl];
    this.save();
  }
}
