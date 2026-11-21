import fs from "node:fs";
import path from "node:path";
import { normalizeItemName } from "./price-message.js";

const EMPTY_DATA = { guilds: {} };

export class RangesStore {
  constructor(filePath = path.resolve("data", "ranges.json")) {
    this.filePath = filePath;
    this.data = this.#load();
  }

  getRanges(guildId) {
    return this.#getGuild(guildId).ranges;
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

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, this.filePath);
  }
}
