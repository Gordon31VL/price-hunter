import "dotenv/config";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import {
  handleChannelCommand,
  handleNotifyRoleCommand,
  handleRangeAutocomplete,
  handleRangeCommand,
} from "./commands.js";
import { parsePriceMessage } from "./price-message.js";
import {
  createPriceEmbeds,
  findOffersInRanges,
  PRICE_REPORT_FOOTER,
  ROLE_SUBSCRIPTION_EMOJI,
} from "./price-report.js";
import { RangesStore } from "./ranges-store.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("Set DISCORD_TOKEN in your .env file.");
}

const store = new RangesStore();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  for (const guild of readyClient.guilds.cache.values()) {
    const channelId = store.getChannelId(guild.id);
    if (channelId) {
      console.log(`Price channel for ${guild.name}: ${channelId}`);
    } else {
      console.warn(`No price channel configured for ${guild.name}. Use /channel set.`);
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (
    message.author.id === client.user?.id ||
    !message.guildId ||
    store.getChannelId(message.guildId) !== message.channelId
  ) {
    return;
  }

  const messageText = [
    message.content,
    ...message.embeds.flatMap((embed) => [
      embed.title,
      embed.description,
      ...embed.fields.flatMap((field) => [field.name, field.value]),
    ]),
  ]
    .filter(Boolean)
    .join("\n");
  const offersByItem = parsePriceMessage(messageText);
  if (offersByItem.size === 0) {
    if (/Скупщик|:\s*\$\d/u.test(messageText)) {
      console.warn(
        `Could not parse price-like message ${message.id}. Check its format and the Message Content Intent setting.`,
      );
    }
    return;
  }

  try {
    store.rememberItems(message.guildId, offersByItem);
    const ranges = store.getRanges(message.guildId);
    const priceGroups = findOffersInRanges(offersByItem, ranges);
    const embeds = createPriceEmbeds(priceGroups, message.createdAt);
    const notifyRoleId = store.getNotifyRoleId(message.guildId);
    for (const [index, embed] of embeds.entries()) {
      const shouldMentionRole = index === 0 && notifyRoleId;
      const reportMessage = await message.channel.send({
        ...(shouldMentionRole ? { content: `<@&${notifyRoleId}>` } : {}),
        embeds: [embed],
        allowedMentions: {
          parse: [],
          roles: shouldMentionRole ? [notifyRoleId] : [],
        },
      });
      try {
        await reportMessage.react(ROLE_SUBSCRIPTION_EMOJI);
      } catch (error) {
        console.error(
          `Could not add the ${ROLE_SUBSCRIPTION_EMOJI} role reaction to report ${reportMessage.id}:`,
          error,
        );
      }
    }
  } catch (error) {
    console.error("Could not process or publish the price message:", error);
    await message.reply("Не удалось обработать список цен. Проверьте логи бота.");
  }
});

async function updateRoleForReaction(reaction, user, shouldAddRole) {
  try {
    if (reaction.partial) {
      await reaction.fetch();
    }
    if (reaction.message.partial) {
      await reaction.message.fetch();
    }
    if (user.partial) {
      user = await user.fetch();
    }

    const message = reaction.message;
    const guildId = message.guildId;
    if (
      user.bot ||
      reaction.emoji.name !== ROLE_SUBSCRIPTION_EMOJI ||
      !guildId ||
      message.author?.id !== client.user?.id ||
      message.channelId !== store.getChannelId(guildId) ||
      !message.embeds.some(
        (embed) => embed.footer?.text === PRICE_REPORT_FOOTER,
      )
    ) {
      return;
    }

    const roleId = store.getNotifyRoleId(guildId);
    if (!roleId) {
      return;
    }

    const role = await message.guild.roles.fetch(roleId);
    if (!role) {
      console.warn(`Configured notification role ${roleId} no longer exists.`);
      return;
    }

    const member = await message.guild.members.fetch(user.id);
    if (shouldAddRole) {
      await member.roles.add(role, "User subscribed to price notifications");
    } else {
      await member.roles.remove(role, "User unsubscribed from price notifications");
    }
  } catch (error) {
    console.error("Could not update a member role from a price report reaction:", error);
  }
}

client.on(Events.MessageReactionAdd, (reaction, user) =>
  updateRoleForReaction(reaction, user, true),
);
client.on(Events.MessageReactionRemove, (reaction, user) =>
  updateRoleForReaction(reaction, user, false),
);

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (
        interaction.commandName !== "range" ||
        !interaction.guildId ||
        store.getChannelId(interaction.guildId) !== interaction.channelId
      ) {
        await interaction.respond([]);
        return;
      }
      await handleRangeAutocomplete(interaction, store);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "channel") {
      await handleChannelCommand(interaction, store);
      return;
    }

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "notify-role"
    ) {
      await handleNotifyRoleCommand(interaction, store);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "range") {
      if (
        !interaction.guildId ||
        store.getChannelId(interaction.guildId) !== interaction.channelId
      ) {
        await interaction.reply({
          content: "Команды диапазонов доступны только в выбранном канале.",
          ephemeral: true,
        });
        return;
      }
      await handleRangeCommand(interaction, store);
    }
  } catch (error) {
    console.error("Could not handle Discord interaction:", error);
    const response = {
      content: "Не удалось выполнить команду. Проверьте логи бота.",
      ephemeral: true,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
});

client.login(token);
