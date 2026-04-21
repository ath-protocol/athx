import { Command } from "commander";
import { buildGatewayClient, buildNativeClient, resolveMode, handleError, loadConfig, loadCredentialStore } from "../shared.js";

export const revokeCommand = new Command("revoke")
  .description("Revoke the current ATH access token")
  .option("--provider <id>", "Provider whose token to revoke")
  .option("-m, --mode <mode>", "Connection mode (gateway|native)", "gateway")
  .option("-g, --gateway <url>", "Gateway URL or config name (gateway mode)")
  .option("-s, --service <url>", "Service URL (native mode)")
  .option("--agent-id <uri>", "Agent identity URI")
  .option("--key <path>", "Path to ES256 private key (PEM)")
  .action(async (opts) => {
    try {
      const mode = resolveMode(opts);

      if (mode === "native") {
        const { client, url } = await buildNativeClient(opts);
        if (opts.provider) client.restoreToken(opts.provider);
        await client.revoke();
        if (opts.provider) {
          const config = loadConfig();
          loadCredentialStore(config).removeToken(url, opts.provider);
        }
      } else {
        const { client, url } = await buildGatewayClient(opts);
        if (opts.provider) client.restoreToken(opts.provider);
        await client.revoke();
        if (opts.provider) {
          const config = loadConfig();
          loadCredentialStore(config).removeToken(url, opts.provider);
        }
      }

      console.log("Token revoked.");
    } catch (err) {
      handleError(err);
    }
  });
