import "dotenv/config";
import { REST, Routes } from "discord.js";
import {
  channelCommand,
  notifyRoleCommand,
  rangeCommand,
  whoCommand,
} from "./commands.js";

const { DISCORD_TOKEN, DISCORD_CLIENT_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  throw new Error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID in your .env file.");
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
  body: [
    channelCommand.toJSON(),
    notifyRoleCommand.toJSON(),
    rangeCommand.toJSON(),
    whoCommand.toJSON(),
  ],
});
console.log("Discord slash commands registered.");
