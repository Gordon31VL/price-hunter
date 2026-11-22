import fs from "node:fs";
import path from "node:path";
import { normalizeItemName } from "./price-message.js";

const EMPTY_DATA = { guilds: {} };
const EMPTY_PERSONAL_DATA = { guilds: {}, notifications: {} };

export class RangesStore {
  constructor(
    filePath = path.resolve("data", "ranges.json"),
    personalFilePath = path.join(path.dirname(filePath), "personal-ranges.json"),
  ) {
    this.filePath = filePath;
    this.personalFilePath = personalFilePath;
    this.data = this.#load();
    this.personalData = this.#loadPersonal();
    this.#migrateLegacyPersonalRanges();
  }

  getRanges(guildId) {
    return this.#getGuild(guildId).ranges;
  }

  getPersonalRanges(guildId, userId) {
    if (!userId) {
      throw new Error("A user ID is required to access personal price ranges.");
    }

    return this.#getPersonalGuild(guildId)[userId] ?? {};
  }

  getPersonalRangeUserIds(guildId) {
    const personalRanges = this.#getPersonalGuild(guildId);
    return Object.entries(personalRanges)
      .filter(([, ranges]) => Object.keys(ranges).length > 0)
      .map(([userId]) => userId);
  }

  arePersonalNotificationsEnabled(guildId, userId) {
    if (!userId) {
      throw new Error("A user ID is required to access personal notifications.");
    }

    return this.personalData.notifications?.[guildId]?.[userId] !== false;
  }

  setPersonalNotificationsEnabled(guildId, userId, enabled) {
    if (!userId) {
      throw new Error("A user ID is required to update personal notifications.");
    }

    this.#getPersonalGuild(guildId);
    this.personalData.notifications ??= {};
    this.personalData.notifications[guildId] ??= {};
    this.personalData.notifications[guildId][userId] = Boolean(enabled);
    this.#savePersonal();
  }

  setPersonalRange(guildId, userId, item, minimum, maximum) {
    if (!userId) {
      throw new Error("A user ID is required to set a personal price range.");
    }

    const guild = this.#getPersonalGuild(guildId);
    guild[userId] ??= {};
    const key = normalizeItemName(item);
    guild[userId][key] = { item: item.trim(), minimum, maximum };
    this.#savePersonal();
  }

  clearPersonalRange(guildId, userId, item) {
    if (!userId) {
      throw new Error("A user ID is required to clear a personal price range.");
    }

    const guild = this.#getPersonalGuild(guildId);
    const userRanges = guild[userId];
    if (!userRanges) {
      return false;
    }

    const key = normalizeItemName(item);
    const existed = Object.hasOwn(userRanges, key);
    if (!existed) {
      return false;
    }

    delete userRanges[key];
    if (Object.keys(userRanges).length === 0) {
      delete guild[userId];
    }
    this.#savePersonal();
    return true;
  }

  getChannelId(guildId) {
    return this.#getGuild(guildId).channelId ?? null;
  }

  setChannelId(guildId, channelId) {
    this.#getGuild(guildId).channelId = channelId;
    this.#save();
  }

  getNotifyRoleId(guildId) {
    return this.#getGuild(guildId).notifyRoleId ?? null;
  }

  setNotifyRoleId(guildId, roleId) {
    this.#getGuild(guildId).notifyRoleId = roleId;
    this.#save();
  }

  getKnownItems(guildId) {
    return Object.values(this.#getGuild(guildId).items);
  }

  rememberItems(guildId, offersByItem) {
    const guild = this.#getGuild(guildId);
    let changed = false;

    for (const offers of offersByItem.values()) {
      const item = offers[0].item;
      const key = normalizeItemName(item);
      if (guild.items[key] !== item) {
        guild.items[key] = item;
        changed = true;
      }
    }

    if (changed) {
      this.#save();
    }
  }

  setRange(guildId, item, minimum, maximum) {
    const guild = this.#getGuild(guildId);
    const key = normalizeItemName(item);
    guild.ranges[key] = { item: item.trim(), minimum, maximum };
    guild.items[key] = item.trim();
    this.#save();
  }

  clearRange(guildId, item) {
    const guild = this.#getGuild(guildId);
    const key = normalizeItemName(item);
    const existed = Object.hasOwn(guild.ranges, key);
    delete guild.ranges[key];
    if (existed) {
      this.#save();
    }
    return existed;
  }

  #getGuild(guildId) {
    if (!guildId) {
      throw new Error("A guild ID is required to access price ranges.");
    }

    this.data.guilds[guildId] ??= { ranges: {}, items: {}, channelId: null };
    return this.data.guilds[guildId];
  }

  #getPersonalGuild(guildId) {
    if (!guildId) {
      throw new Error("A guild ID is required to access personal price ranges.");
    }

    this.personalData.guilds[guildId] ??= {};
    return this.personalData.guilds[guildId];
  }

  #migrateLegacyPersonalRanges() {
    let hasLegacyRanges = false;
    for (const [guildId, guild] of Object.entries(this.data.guilds)) {
      if (!Object.hasOwn(guild, "personalRanges")) {
        continue;
      }

      const legacyGuildRanges = guild.personalRanges;
      if (
        !legacyGuildRanges ||
        typeof legacyGuildRanges !== "object" ||
        Array.isArray(legacyGuildRanges)
      ) {
        throw new Error(
          `Invalid ranges file: expected personal ranges for guild ${guildId} to be an object.`,
        );
      }

      const personalGuild = (this.personalData.guilds[guildId] ??= {});
      for (const [userId, legacyRanges] of Object.entries(legacyGuildRanges)) {
        personalGuild[userId] = {
          ...legacyRanges,
          ...(personalGuild[userId] ?? {}),
        };
      }
      delete guild.personalRanges;
      hasLegacyRanges = true;
    }

    if (hasLegacyRanges) {
      this.#savePersonal();
      this.#save();
    }
  }

  #load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!data || typeof data.guilds !== "object" || Array.isArray(data.guilds)) {
        throw new Error("Invalid ranges file: expected a guilds object.");
      }
      return data;
    } catch (error) {
      if (error.code === "ENOENT") {
        return structuredClone(EMPTY_DATA);
      }
      throw error;
    }
  }

  #loadPersonal() {
    try {
      const data = JSON.parse(fs.readFileSync(this.personalFilePath, "utf8"));
      if (!data || typeof data.guilds !== "object" || Array.isArray(data.guilds)) {
        throw new Error(
          "Invalid personal ranges file: expected a guilds object.",
        );
      }
      return data;
    } catch (error) {
      if (error.code === "ENOENT") {
        return structuredClone(EMPTY_PERSONAL_DATA);
      }
      throw error;
    }
  }

  #save() {
    this.#write(this.filePath, this.data);
  }

  #savePersonal() {
    this.#write(this.personalFilePath, this.personalData);
  }

  #write(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, filePath);
  }
}
