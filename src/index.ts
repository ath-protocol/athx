/**
 * athx — ATH protocol client for agents and orchestrators.
 *
 * Supports both gateway mode and native mode.
 */
export { ATHXGatewayClient } from "./gateway-client.js";
export { ATHXNativeClient } from "./native-client.js";
export { CredentialStore, type StoredCredentials, type StoredToken } from "./credential-store.js";
export { Config, type ATHXConfig, type GatewayEntry } from "./config.js";
export { ATHClientError } from "@ath-protocol/client";
export type {
  DiscoveryDocument,
  ServiceDiscoveryDocument,
  AgentRegistrationResponse,
  AuthorizationResponse,
  TokenResponse,
  ATHErrorCode,
  ProviderInfo,
  ScopeIntersection,
  DeveloperInfo,
  ProviderScopeRequest,
} from "@ath-protocol/types";
