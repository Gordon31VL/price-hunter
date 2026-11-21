import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { PRICE_LIST_ITEMS } from "./items.js";
import { normalizeItemName } from "./price-message.js";

export const channelCommand = new SlashCommandBuilder()
  .setName("channel")
  .setDescription("Выбрать канал для обработки цен ботом")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set")
      .setDescription("Установить канал для списков цен")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Канал, в котором бот будет читать списки цен")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("show").setDescription("Показать выбранный канал"),
  );

export const notifyRoleCommand = new SlashCommandBuilder()
  .setName("notify-role")
  .setDescription("Настроить роль, которую бот будет упоминать при публикации цен")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set")
      .setDescription("Выбрать роль для уведомлений")
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("Роль, которую бот будет упоминать")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("show").setDescription("Показать выбранную роль"),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("clear").setDescription("Отключить упоминание роли"),
  );

export const rangeCommand = new SlashCommandBuilder()
  .setName("range")
  .setDescription("Настроить диапазоны цен товаров")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set")
      .setDescription("Установить диапазон цены для товара")
      .addStringOption((option) =>
        option
          .setName("item")
          .setDescription("Название товара")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addIntegerOption((option) =>
        option
          .setName("minimum")
          .setDescription("Минимальная цена")
          .setMinValue(0)
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName("maximum")
          .setDescription("Максимальная цена")
          .setMinValue(0)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("Показать установленные диапазоны"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("clear")
      .setDescription("Удалить диапазон цены для товара")
      .addStringOption((option) =>
        option
          .setName("item")
          .setDescription("Название товара")
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

export async function handleRangeAutocomplete(interaction, store) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.respond([]);
    return;
  }

  const query = interaction.options.getFocused();
  await interaction.respond(getRangeItemSuggestions(store, guildId, query));
}

export function getRangeItemSuggestions(store, guildId, query = "") {
  const normalizedQuery = normalizeItemName(query);
  const items = new Map();
  const candidates = [
    ...PRICE_LIST_ITEMS,
    ...store.getKnownItems(guildId),
    ...Object.values(store.getRanges(guildId)).map((range) => range.item),
  ];

  for (const item of candidates) {
    const key = normalizeItemName(item);
    if (key.includes(normalizedQuery) && !items.has(key)) {
      items.set(key, item);
    }
  }

  return [...items.values()]
    .slice(0, 25)
    .map((item) => ({ name: item, value: item }));
}

export async function handleChannelCommand(interaction, store) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Выбрать канал можно только на сервере.",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Для настройки канала необходимо право «Управление сервером».",
      ephemeral: true,
    });
    return;
  }

  if (interaction.options.getSubcommand() === "set") {
    const channel = interaction.options.getChannel("channel", true);
    store.setChannelId(interaction.guildId, channel.id);
    await interaction.reply({
      content: `Бот будет обрабатывать списки цен в канале <#${channel.id}>.`,
      ephemeral: true,
    });
    return;
  }

  const channelId = store.getChannelId(interaction.guildId);
  await interaction.reply({
    content: channelId
      ? `Сейчас выбран канал <#${channelId}>.`
      : "Канал ещё не выбран. Используйте `/channel set`.",
    ephemeral: true,
  });
}

export async function handleNotifyRoleCommand(interaction, store) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Настроить роль уведомлений можно только на сервере.",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Для настройки роли необходимо право «Управление сервером».",
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId;
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "set") {
    const role = interaction.options.getRole("role", true);
    const botMember =
      interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
    if (
      role.id === interaction.guild.id ||
      role.managed ||
      !botMember.permissions.has(PermissionFlagsBits.ManageRoles) ||
      role.comparePositionTo(botMember.roles.highest) >= 0
    ) {
      await interaction.reply({
        content:
          "Бот не может выдавать эту роль. Выберите обычную роль ниже высшей роли бота и убедитесь, что у бота есть право «Управление ролями».",
        ephemeral: true,
      });
      return;
    }

    store.setNotifyRoleId(guildId, role.id);
    await interaction.reply({
      content: `При публикации цен бот будет упоминать роль ${role} и выдавать её по реакции 🔔. Убедитесь, что роль разрешено упоминать.`,
      allowedMentions: { parse: [] },
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "clear") {
    store.setNotifyRoleId(guildId, null);
    await interaction.reply({
      content: "Упоминание роли при публикации цен отключено.",
      ephemeral: true,
    });
    return;
  }

  const roleId = store.getNotifyRoleId(guildId);
  await interaction.reply({
    content: roleId
      ? `Сейчас для уведомлений выбрана роль <@&${roleId}>.`
      : "Роль уведомлений не выбрана. Используйте `/notify-role set`.",
    allowedMentions: { parse: [] },
    ephemeral: true,
  });
}

export async function handleRangeCommand(interaction, store) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Команды диапазонов доступны только на сервере.",
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "set") {
    const item = interaction.options.getString("item", true).trim();
    const minimum = interaction.options.getInteger("minimum", true);
    const maximum = interaction.options.getInteger("maximum", true);
    if (!item || minimum > maximum) {
      await interaction.reply({
        content: "Укажите товар и корректные границы: минимум не должен превышать максимум.",
        ephemeral: true,
      });
      return;
    }

    store.setRange(guildId, item, minimum, maximum);
    await interaction.reply({
      content: `Диапазон для **${item}** установлен: **$${minimum}–$${maximum}**.`,
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "clear") {
    const item = interaction.options.getString("item", true);
    const removed = store.clearRange(guildId, item);
    await interaction.reply({
      content: removed
        ? `Диапазон для **${item}** удалён.`
        : `Для **${item}** диапазон не был установлен.`,
      ephemeral: true,
    });
    return;
  }

  const ranges = Object.values(store.getRanges(guildId)).sort((left, right) =>
    left.item.localeCompare(right.item, "ru-RU"),
  );
  await interaction.reply({
    content:
      ranges.length > 0
        ? `**Установленные диапазоны цен:**\n${ranges
            .map((range) => `• **${range.item}** — $${range.minimum}–$${range.maximum}`)
            .join("\n")}`
        : "Диапазоны пока не установлены. Используйте `/range set`.",
    ephemeral: true,
  });
}
