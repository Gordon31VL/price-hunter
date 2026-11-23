import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  handleChannelCommand,
  handleNotifyRoleCommand,
  handleRangeAutocomplete,
  handleRangeCommand,
  formatRangeList,
  formatPersonalRangeList,
  getRangeItemSuggestions,
  whoCommand,
} from "./commands.js";
import { normalizeItemName, parsePriceMessage } from "./price-message.js";
import {
  createPriceEmbeds,
  findOffersInRanges,
  formatMaximumPriceList,
  getScreenshotMaximumPrice,
  PRICE_REPORT_FOOTER,
  ROLE_SUBSCRIPTION_EMOJI,
} from "./price-report.js";
import { RangesStore } from "./ranges-store.js";
import { UpdateNoticeStore } from "./update-notice-store.js";
import {
  loadUpdateNotice,
  removeUpdateNotice,
  UPDATE_NOTICE_ID,
} from "./update-notice.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("Set DISCORD_TOKEN in your .env file.");
}

const botOwnerId = process.env.BOT_OWNER_ID;
const SHOW_RANGES_BUTTON_ID = "show-price-ranges";
const SHOW_MAX_PRICES_BUTTON_ID = "show-max-prices";
const PERSONAL_RANGE_BUTTON_ID = "configure-personal-range";
const PERSONAL_RANGE_SELECT_PREFIX = "personal-range-item";
const PERSONAL_RANGE_MODAL_PREFIX = "personal-range-modal";
const DM_PERSONAL_MANAGE_PREFIX = "dm-personal-manage";
const DM_PERSONAL_SELECT_PREFIX = "dm-personal-range-item";
const DM_PERSONAL_NOTIFICATIONS_PREFIX = "dm-personal-notifications";
const DM_PERSONAL_VIEW_RANGES_PREFIX = "dm-personal-view-ranges";
const DM_MAX_PRICES_PREFIX = "dm-max-prices";
const pendingPersonalRanges = new Map();
const store = new RangesStore();
const updatedPersonalMaximums = store.updatePersonalRangeMaximums(
  "personal-range-maximums-2026-11-23",
  ["Шкура", "Идеальное мясо", "Хорошее мясо"].map((item) => ({
    item,
    maximum: getScreenshotMaximumPrice(item),
  })),
);
if (updatedPersonalMaximums > 0) {
  console.log(
    `Updated saved personal maximums for ${updatedPersonalMaximums} product ranges.`,
  );
}
const updateNoticeStore = new UpdateNoticeStore();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
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

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  const updateNotice = loadUpdateNotice();
  let hasConfiguredPriceChannel = false;
  let allConfiguredChannelsNotified = true;
  for (const guild of readyClient.guilds.cache.values()) {
    const channelId = store.getChannelId(guild.id);
    if (channelId) {
      hasConfiguredPriceChannel = true;
      console.log(`Price channel for ${guild.name}: ${channelId}`);
      if (updateNoticeStore.hasSent(guild.id, UPDATE_NOTICE_ID)) {
        continue;
      }

      if (!updateNotice) {
        allConfiguredChannelsNotified = false;
        continue;
      }

      try {
        const channel = await guild.channels.fetch(channelId);
        if (!channel?.isTextBased() || typeof channel.send !== "function") {
          allConfiguredChannelsNotified = false;
          console.error(
            `Cannot post the update notice for ${guild.name}: configured price channel ${channelId} is not a text channel.`,
          );
          continue;
        }

        await channel.send({
          embeds: [updateNotice],
          allowedMentions: { parse: [] },
        });
        updateNoticeStore.markSent(guild.id, UPDATE_NOTICE_ID);
      } catch (error) {
        allConfiguredChannelsNotified = false;
        console.error(
          `Could not post the one-time update notice for ${guild.name}:`,
          error,
        );
      }
    } else {
      console.warn(`No price channel configured for ${guild.name}. Use /channel set.`);
    }
  }

  if (updateNotice && hasConfiguredPriceChannel && allConfiguredChannelsNotified) {
    try {
      removeUpdateNotice();
      console.log("The one-time update notice content file was removed.");
    } catch (error) {
      console.error("Could not remove the one-time update notice content file:", error);
    }
  }
});

function isPriceReportMessage(interaction) {
  const message = interaction.message;
  return Boolean(
    interaction.guildId &&
      interaction.channelId === store.getChannelId(interaction.guildId) &&
      message.author?.id === client.user?.id &&
      message.embeds.some(
        (embed) => embed.footer?.text === PRICE_REPORT_FOOTER,
      ),
  );
}

function getPersonalRangeOptions(guildId, userId) {
  const personalRanges = store.getPersonalRanges(guildId, userId);
  const items = new Map();
  const candidates = [
    ...Object.values(personalRanges).map((range) => range.item),
    ...getRangeItemSuggestions(store, guildId).map((suggestion) => suggestion.value),
  ];

  for (const item of candidates) {
    const key = normalizeItemName(item);
    if (item.length <= 100 && !items.has(key)) {
      items.set(key, item);
    }
  }

  return [...items.values()].slice(0, 25).map((item) => {
    const currentRange = personalRanges[normalizeItemName(item)];
    return {
      label: item,
      value: item,
      ...(currentRange
        ? {
            description: `Сейчас: $${currentRange.minimum}–$${currentRange.maximum}`,
          }
        : {}),
    };
  });
}

function addPersonalNotificationStatus(content, enabled) {
  return `${content}\n\nЛичные уведомления: ${enabled ? "включены" : "выключены"}.`;
}

function getGuildDisplayName(guildId) {
  return client.guilds.cache.get(guildId)?.name ?? "этого сервера";
}

function createPersonalDmComponents(guildId, userId) {
  const notificationsEnabled = store.arePersonalNotificationsEnabled(
    guildId,
    userId,
  );
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${DM_PERSONAL_VIEW_RANGES_PREFIX}:${guildId}:${userId}`)
        .setLabel("Мои личные цены")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${DM_MAX_PRICES_PREFIX}:${guildId}:${userId}`)
        .setLabel("Максимальные цены и +20%")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${DM_PERSONAL_MANAGE_PREFIX}:${guildId}:${userId}`)
        .setLabel("Изменить диапазоны")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${DM_PERSONAL_NOTIFICATIONS_PREFIX}:${guildId}:${userId}`)
        .setLabel(
          notificationsEnabled
            ? "Выключить уведомления"
            : "Включить уведомления",
        )
        .setStyle(
          notificationsEnabled ? ButtonStyle.Danger : ButtonStyle.Success,
        ),
    ),
  ];
}

function getInteractionPrivacyOptions(interaction) {
  return interaction.guildId ? { flags: MessageFlags.Ephemeral } : {};
}

async function sendPersonalSettingsPanel(guildId, userId) {
  try {
    const user = await client.users.fetch(userId);
    const enabled = store.arePersonalNotificationsEnabled(guildId, userId);
    await user.send({
      content: addPersonalNotificationStatus(
        `Управление личными диапазонами цен для сервера **${getGuildDisplayName(guildId)}**.`,
        enabled,
      ),
      components: createPersonalDmComponents(guildId, userId),
    });
  } catch (error) {
    console.error(
      `Could not send personal settings to user ${userId} in guild ${guildId}:`,
      error,
    );
  }
}

async function replyToPersonalRangeUpdate(interaction, pending, content) {
  if (pending.isDm) {
    const enabled = store.arePersonalNotificationsEnabled(
      pending.guildId,
      pending.userId,
    );
    await interaction.reply({
      content: addPersonalNotificationStatus(content, enabled),
      components: createPersonalDmComponents(
        pending.guildId,
        pending.userId,
      ),
    });
    return;
  }

  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
  });
  await sendPersonalSettingsPanel(pending.guildId, pending.userId);
}

async function sendPersonalPriceReports(
  guildId,
  offersByItem,
  publishedAt,
  sourceUrl,
) {
  for (const userId of store.getPersonalRangeUserIds(guildId)) {
    if (!store.arePersonalNotificationsEnabled(guildId, userId)) {
      continue;
    }

    const priceGroups = findOffersInRanges(
      offersByItem,
      store.getPersonalRanges(guildId, userId),
    );
    if (priceGroups.length === 0) {
      continue;
    }

    try {
      const user = await client.users.fetch(userId);
      const enabled = store.arePersonalNotificationsEnabled(guildId, userId);
      await user.send({
        content: addPersonalNotificationStatus(
          `🔔 Новые предложения на сервере **${getGuildDisplayName(guildId)}** ` +
            "попали в ваши личные диапазоны цен:",
          enabled,
        ),
        embeds: createPriceEmbeds(priceGroups, publishedAt, sourceUrl),
        components: createPersonalDmComponents(guildId, userId),
      });
    } catch (error) {
      console.error(
        `Could not send a personal price report to user ${userId} in guild ${guildId}:`,
        error,
      );
    }
  }
}

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
    return;
  }

  const botPermissions = message.channel.permissionsFor(client.user);
  if (
    !botPermissions?.has(PermissionFlagsBits.ViewChannel) ||
    !botPermissions.has(PermissionFlagsBits.SendMessages) ||
    !botPermissions.has(PermissionFlagsBits.EmbedLinks)
  ) {
    console.error(
      `Cannot publish the price report in channel ${message.channelId}: ` +
        "the bot needs View Channel, Send Messages, and Embed Links permissions.",
    );
    return;
  }

  try {
    store.rememberItems(message.guildId, offersByItem);
    await sendPersonalPriceReports(
      message.guildId,
      offersByItem,
      message.createdAt,
      message.url,
    );
    const ranges = store.getRanges(message.guildId);
    const priceGroups = findOffersInRanges(offersByItem, ranges);
    const embeds = createPriceEmbeds(priceGroups, message.createdAt, message.url);
    const components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(SHOW_RANGES_BUTTON_ID)
          .setLabel("Посмотреть диапазоны цен")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(SHOW_MAX_PRICES_BUTTON_ID)
          .setLabel("Максимальные цены +20%")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(PERSONAL_RANGE_BUTTON_ID)
          .setLabel("Личный диапазон цен")
          .setStyle(ButtonStyle.Primary),
      ),
    ];
    const notifyRoleId = store.getNotifyRoleId(message.guildId);
    const canMentionRoles =
      Boolean(notifyRoleId) &&
      botPermissions.has(PermissionFlagsBits.MentionEveryone);
    for (const [index, embed] of embeds.entries()) {
      const shouldMentionRole = index === 0 && canMentionRoles;
      const reportMessage = await message.channel.send({
        ...(shouldMentionRole ? { content: `<@&${notifyRoleId}>` } : {}),
        embeds: [embed],
        components,
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
    try {
      await message.reply("Не удалось обработать список цен. Проверьте логи бота.");
    } catch (replyError) {
      console.error("Could not send the price-processing error reply:", replyError);
    }
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

    if (interaction.isChatInputCommand() && interaction.commandName === "who") {
      const privacyOptions = getInteractionPrivacyOptions(interaction);
      if (!botOwnerId || interaction.user.id !== botOwnerId) {
        await interaction.reply({
          content: "Эта команда доступна только владельцу бота.",
          ...privacyOptions,
        });
        return;
      }

      const targetId = interaction.options.getString("id", true).trim();
      if (!/^\d{17,20}$/u.test(targetId)) {
        await interaction.reply({
          content: "Укажите корректный Discord ID (17–20 цифр).",
          ...privacyOptions,
        });
        return;
      }

      let targetUser;
      try {
        targetUser = await client.users.fetch(targetId);
      } catch (error) {
        if (error.code !== 10013) {
          throw error;
        }
      }

      if (targetUser) {
        await interaction.reply({
          content: `<@${targetId}>`,
          allowedMentions: { parse: [], users: [targetId] },
          ...privacyOptions,
        });
        return;
      }

      try {
        const guild = await client.guilds.fetch(targetId);
        await interaction.reply({
          content:
            `Сервер: **${guild.name}**\nhttps://discord.com/channels/${guild.id}`,
          ...privacyOptions,
        });
      } catch (error) {
        if (error.code !== 10004 && error.code !== 50001) {
          throw error;
        }
        await interaction.reply({
          content:
            "Пользователь не найден. Чтобы определить сервер, бот должен состоять на нём.",
          ...privacyOptions,
        });
      }
      return;
    }

    if (
      interaction.isButton() &&
      interaction.customId.startsWith(`${DM_PERSONAL_MANAGE_PREFIX}:`)
    ) {
      const [, guildId, ownerId] = interaction.customId.split(":");
      if (
        interaction.guildId ||
        ownerId !== interaction.user.id ||
        !/^\d+$/u.test(guildId)
      ) {
        await interaction.reply({
          content: "Эта настройка доступна только её владельцу в личных сообщениях.",
          ...getInteractionPrivacyOptions(interaction),
        });
        return;
      }

      const itemSelect = new StringSelectMenuBuilder()
        .setCustomId(
          `${DM_PERSONAL_SELECT_PREFIX}:${guildId}:${interaction.user.id}`,
        )
        .setPlaceholder("Выберите товар")
        .addOptions(getPersonalRangeOptions(guildId, interaction.user.id));
      await interaction.reply({
        content:
          `Выберите товар для сервера **${getGuildDisplayName(guildId)}** и укажите новые границы. ` +
          "Максимум для товара подставляется автоматически; оставьте обе цены пустыми, чтобы удалить диапазон.",
        components: [new ActionRowBuilder().addComponents(itemSelect)],
      });
      return;
    }

    if (
      interaction.isButton() &&
      (interaction.customId.startsWith(`${DM_PERSONAL_VIEW_RANGES_PREFIX}:`) ||
        interaction.customId.startsWith(`${DM_MAX_PRICES_PREFIX}:`))
    ) {
      const [prefix, guildId, ownerId] = interaction.customId.split(":");
      if (
        interaction.guildId ||
        ownerId !== interaction.user.id ||
        !/^\d+$/u.test(guildId)
      ) {
        await interaction.reply({
          content: "Эта настройка доступна только её владельцу в личных сообщениях.",
          ...getInteractionPrivacyOptions(interaction),
        });
        return;
      }

      await interaction.reply({
        content:
          prefix === DM_PERSONAL_VIEW_RANGES_PREFIX
            ? formatPersonalRangeList(
                store.getPersonalRanges(guildId, interaction.user.id),
              )
            : formatMaximumPriceList(),
      });
      return;
    }

    if (
      interaction.isButton() &&
      interaction.customId.startsWith(`${DM_PERSONAL_NOTIFICATIONS_PREFIX}:`)
    ) {
      const [, guildId, ownerId] = interaction.customId.split(":");
      if (
        interaction.guildId ||
        ownerId !== interaction.user.id ||
        !/^\d+$/u.test(guildId)
      ) {
        await interaction.reply({
          content: "Эта настройка доступна только её владельцу в личных сообщениях.",
          ...getInteractionPrivacyOptions(interaction),
        });
        return;
      }

      const enabled = !store.arePersonalNotificationsEnabled(
        guildId,
        interaction.user.id,
      );
      store.setPersonalNotificationsEnabled(
        guildId,
        interaction.user.id,
        enabled,
      );
      const content = interaction.message.content.replace(
        /\n\nЛичные уведомления: (?:включены|выключены)\.$/u,
        "",
      );
      await interaction.update({
        content: addPersonalNotificationStatus(content, enabled),
        components: createPersonalDmComponents(guildId, interaction.user.id),
      });
      return;
    }

    if (
      interaction.isButton() &&
      [
        SHOW_RANGES_BUTTON_ID,
        SHOW_MAX_PRICES_BUTTON_ID,
        PERSONAL_RANGE_BUTTON_ID,
      ].includes(
        interaction.customId,
      )
    ) {
      if (!isPriceReportMessage(interaction)) {
        await interaction.reply({
          content: "Эта кнопка доступна только в сообщении со сводкой цен.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId === PERSONAL_RANGE_BUTTON_ID) {
        const options = getPersonalRangeOptions(
          interaction.guildId,
          interaction.user.id,
        );
        const itemSelect = new StringSelectMenuBuilder()
          .setCustomId(`${PERSONAL_RANGE_SELECT_PREFIX}:${interaction.user.id}`)
          .setPlaceholder("Выберите товар")
          .addOptions(options);
        await interaction.reply({
          content:
            "Выберите товар, затем задайте личные границы. " +
            "Максимум подставится автоматически; чтобы удалить диапазон, оставьте обе цены пустыми. " +
            "Учитывайте только цены без бонуса 3-х часов.",
          components: [new ActionRowBuilder().addComponents(itemSelect)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        content:
          interaction.customId === SHOW_RANGES_BUTTON_ID
            ? formatRangeList(store.getRanges(interaction.guildId))
            : formatMaximumPriceList(),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isGuildPersonalRangeSelect =
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith(`${PERSONAL_RANGE_SELECT_PREFIX}:`);
    const isDmPersonalRangeSelect =
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith(`${DM_PERSONAL_SELECT_PREFIX}:`);
    if (isGuildPersonalRangeSelect || isDmPersonalRangeSelect) {
      const isDm = isDmPersonalRangeSelect;
      const [, dmGuildId, dmOwnerId] = interaction.customId.split(":");
      const guildId = isDm ? dmGuildId : interaction.guildId;
      const ownerId = isDm ? dmOwnerId : interaction.customId.split(":")[1];
      const isInvalidContext =
        ownerId !== interaction.user.id ||
        (isDm
          ? Boolean(interaction.guildId) || !/^\d+$/u.test(guildId)
          : !interaction.guildId ||
            interaction.channelId !== store.getChannelId(interaction.guildId));
      if (isInvalidContext) {
        await interaction.reply({
          content: "Эта настройка доступна только открывшему её пользователю.",
          ...getInteractionPrivacyOptions(interaction),
        });
        return;
      }

      const item = interaction.values[0];
      if (
        !getPersonalRangeOptions(guildId, interaction.user.id).some(
          (option) => option.value === item,
        )
      ) {
        await interaction.reply({
          content: "Выберите товар из списка.",
          ...getInteractionPrivacyOptions(interaction),
        });
        return;
      }

      const nonce = randomUUID().replace(/-/gu, "");
      const expiredBefore = Date.now() - 15 * 60 * 1000;
      for (const [pendingNonce, pending] of pendingPersonalRanges) {
        if (pending.createdAt < expiredBefore) {
          pendingPersonalRanges.delete(pendingNonce);
        }
      }
      pendingPersonalRanges.set(nonce, {
        guildId,
        userId: interaction.user.id,
        item,
        createdAt: Date.now(),
        isDm,
      });
      const currentRange =
        store.getPersonalRanges(guildId, interaction.user.id)[normalizeItemName(item)];
      const automaticMaximum = getScreenshotMaximumPrice(item);
      const minimumInput = new TextInputBuilder()
        .setCustomId("minimum")
        .setLabel("Минимальная цена")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(String(currentRange?.minimum ?? 0))
        .setPlaceholder("Например, 50");
      const maximumInput = new TextInputBuilder()
        .setCustomId("maximum")
        .setLabel(
          automaticMaximum === undefined
            ? "Максимальная цена"
            : "Максимальная цена (авто)",
        )
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder("Например, 100");
      const maximum = automaticMaximum ?? currentRange?.maximum;
      if (maximum !== undefined) {
        maximumInput.setValue(String(maximum));
      }
      const modal = new ModalBuilder()
        .setCustomId(`${PERSONAL_RANGE_MODAL_PREFIX}:${nonce}`)
        .setTitle(`Диапазон: ${item}`)
        .addComponents(
          new ActionRowBuilder().addComponents(minimumInput),
          new ActionRowBuilder().addComponents(maximumInput),
        );
      await interaction.showModal(modal);
      return;
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith(`${PERSONAL_RANGE_MODAL_PREFIX}:`)
    ) {
      const nonce = interaction.customId.split(":")[1];
      const pending = pendingPersonalRanges.get(nonce);
      pendingPersonalRanges.delete(nonce);
      if (
        !pending ||
        pending.userId !== interaction.user.id ||
        (pending.isDm
          ? Boolean(interaction.guildId)
          : pending.guildId !== interaction.guildId) ||
        pending.createdAt < Date.now() - 15 * 60 * 1000
      ) {
        await interaction.reply({
          content: "Срок действия формы истёк. Откройте настройку ещё раз.",
          ...getInteractionPrivacyOptions(interaction),
        });
        return;
      }

      const minimumText = interaction.fields
        .getTextInputValue("minimum")
        .trim();
      const maximumText = interaction.fields
        .getTextInputValue("maximum")
        .trim();
      if (!minimumText && !maximumText) {
        const removed = store.clearPersonalRange(
          pending.guildId,
          pending.userId,
          pending.item,
        );
        await replyToPersonalRangeUpdate(
          interaction,
          pending,
          removed
            ? `Личный диапазон для **${pending.item}** удалён.`
            : `Личный диапазон для **${pending.item}** не был установлен.`,
        );
        return;
      }

      const minimum = Number(minimumText);
      const maximum = Number(maximumText);
      if (
        !minimumText ||
        !maximumText ||
        !/^\d+$/u.test(minimumText) ||
        !/^\d+$/u.test(maximumText) ||
        !Number.isSafeInteger(minimum) ||
        !Number.isSafeInteger(maximum) ||
        minimum < 0 ||
        maximum < minimum
      ) {
        await interaction.reply({
          content:
            "Укажите целые неотрицательные цены; минимум не должен превышать максимум.",
          ...getInteractionPrivacyOptions(interaction),
        });
        return;
      }

      store.setPersonalRange(
        pending.guildId,
        pending.userId,
        pending.item,
        minimum,
        maximum,
      );
      await replyToPersonalRangeUpdate(
        interaction,
        pending,
        `Личный диапазон для **${pending.item}** установлен: ` +
          `**$${minimum}–$${maximum}**.`,
      );
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
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await handleRangeCommand(interaction, store);
    }
  } catch (error) {
    console.error("Could not handle Discord interaction:", error);
    const response = {
      content: "Не удалось выполнить команду. Проверьте логи бота.",
      ...getInteractionPrivacyOptions(interaction),
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
});

client.login(token);
