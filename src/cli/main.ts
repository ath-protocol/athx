#!/usr/bin/env node
/**
 * athx CLI — headless client for the ATH protocol.
 */
import { Command } from "commander";
import { discoverCommand } from "./commands/discover.js";
import { registerCommand } from "./commands/register.js";
import { authorizeCommand } from "./commands/authorize.js";
import { tokenCommand } from "./commands/token.js";
import { proxyCommand } from "./commands/proxy.js";
import { revokeCommand } from "./commands/revoke.js";
import { statusCommand } from "./commands/status.js";
import { configCommand } from "./commands/config.js";

const program = new Command();

program
  .name("athx")
  .description("Headless CLI client for the ATH (Agent Trust Handshake) protocol")
  .version("0.1.0");

program.addCommand(discoverCommand);
program.addCommand(registerCommand);
program.addCommand(authorizeCommand);
program.addCommand(tokenCommand);
program.addCommand(proxyCommand);
program.addCommand(revokeCommand);
program.addCommand(statusCommand);
program.addCommand(configCommand);

program.parse();
