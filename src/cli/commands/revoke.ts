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
      const config = loadConfig();
      const store = loadCredentialStore(config);

      const build = mode === "native" ? buildNativeClient : buildGatewayClient;
      const { client, url } = await build(opts);

      if (opts.provider) {
        const existing = store.getToken(url, opts.provider);
        if (!existing) {
          console.log(
            `No active token for provider '${opts.provider}' at ${url}. Nothing to revoke.`,
          );
          process.exitCode = 1;
          return;
        }
        client.restoreToken(opts.provider);
        await client.revoke();
        store.removeToken(url, opts.provider);
        console.log(`Token revoked for provider '${opts.provider}'.`);
        return;
      }

      const creds = store.getCredentials(url);
      const anyToken =
        creds && Object.keys(creds.tokens).length > 0;
      if (!anyToken) {
        console.log(
          `No active tokens at ${url}. Nothing to revoke. (Tip: pass --provider <id> to target a specific one.)`,
        );
        process.exitCode = 1;
        return;
      }

      await client.revoke();
      console.log("Token revoked.");
    } catch (err) {
      handleError(err);
    }
  });
