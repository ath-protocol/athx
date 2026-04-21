import { Command } from "commander";
import { buildGatewayClient, buildNativeClient, resolveMode, output, handleError } from "../shared.js";

export const proxyCommand = new Command("proxy")
  .description("Make an authenticated API call (proxy in gateway mode, direct in native mode)")
  .argument("<provider>", "Provider ID (gateway mode) or ignored (native mode)")
  .argument("<method>", "HTTP method (GET, POST, PUT, DELETE, PATCH)")
  .argument("<path>", "API path (e.g. /user/repos)")
  .option("--body <json>", "Request body (JSON string)")
  .option("-m, --mode <mode>", "Connection mode (gateway|native)", "gateway")
  .option("-g, --gateway <url>", "Gateway URL or config name (gateway mode)")
  .option("-s, --service <url>", "Service URL (native mode)")
  .option("--agent-id <uri>", "Agent identity URI")
  .option("--key <path>", "Path to ES256 private key (PEM)")
  .option("--format <fmt>", "Output format (text|json)", "text")
  .action(async (provider: string, method: string, apiPath: string, opts) => {
    try {
      const mode = resolveMode(opts);

      let body: unknown;
      if (opts.body) {
        try {
          body = JSON.parse(opts.body);
        } catch {
          throw new Error("--body must be valid JSON");
        }
      }

      let res: unknown;
      if (mode === "native") {
        const { client } = await buildNativeClient(opts);
        await client.discover();
        client.restoreToken(provider);
        res = await client.api(method.toUpperCase(), apiPath, body);
      } else {
        const { client } = await buildGatewayClient(opts);
        client.restoreToken(provider);
        res = await client.proxy(provider, method.toUpperCase(), apiPath, body);
      }

      output(res, opts.format);
    } catch (err) {
      handleError(err);
    }
  });
