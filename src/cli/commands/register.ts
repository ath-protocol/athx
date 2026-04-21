import { Command } from "commander";
import { buildGatewayClient, buildNativeClient, resolveMode, output, handleError } from "../shared.js";

export const registerCommand = new Command("register")
  .description("Register agent with an ATH endpoint (Phase A: app-side authorization)")
  .requiredOption("--provider <id>", "Provider to request access to")
  .requiredOption("--scopes <list>", "Comma-separated scopes to request")
  .option("--purpose <text>", "Purpose description", "CLI agent")
  .option("--dev-name <name>", "Developer name", "athx-user")
  .option("--dev-id <id>", "Developer ID", "athx-dev")
  .option("-m, --mode <mode>", "Connection mode (gateway|native)", "gateway")
  .option("-g, --gateway <url>", "Gateway URL or config name (gateway mode)")
  .option("-s, --service <url>", "Service URL (native mode)")
  .option("--agent-id <uri>", "Agent identity URI")
  .option("--key <path>", "Path to ES256 private key (PEM)")
  .option("--format <fmt>", "Output format (text|json)", "text")
  .action(async (opts) => {
    try {
      const mode = resolveMode(opts);
      const scopes = opts.scopes.split(",").map((s: string) => s.trim());
      const registerOpts = {
        developer: { name: opts.devName, id: opts.devId },
        providers: [{ provider_id: opts.provider, scopes }],
        purpose: opts.purpose,
      };

      const reg = mode === "native"
        ? await (await buildNativeClient(opts)).client.register(registerOpts)
        : await (await buildGatewayClient(opts)).client.register(registerOpts);

      if (opts.format === "json") {
        output(reg, "json");
      } else {
        console.log(`Registration: ${reg.agent_status}`);
        console.log(`Client ID:    ${reg.client_id}`);
        console.log(`Expires:      ${reg.approval_expires}\n`);
        for (const p of reg.approved_providers) {
          console.log(`  ${p.provider_id}:`);
          console.log(`    Approved: ${p.approved_scopes.join(", ") || "(none)"}`);
          if (p.denied_scopes.length > 0) {
            console.log(`    Denied:   ${p.denied_scopes.join(", ")}`);
            if (p.denial_reason) console.log(`    Reason:   ${p.denial_reason}`);
          }
        }
      }
    } catch (err) {
      handleError(err);
    }
  });
