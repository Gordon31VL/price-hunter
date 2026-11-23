import fs from "node:fs";
import path from "node:path";

const EMPTY_DATA = { notices: {} };

export class UpdateNoticeStore {
  constructor(filePath = path.resolve("data", "update-notices.json")) {
    this.filePath = filePath;
    this.data = this.#load();
  }

  hasSent(guildId, noticeId) {
    return this.data.notices[guildId]?.includes(noticeId) ?? false;
  }

  markSent(guildId, noticeId) {
    if (!guildId || !noticeId) {
      throw new Error("Guild ID and notice ID are required.");
    }

    const sentNotices = (this.data.notices[guildId] ??= []);
    if (sentNotices.includes(noticeId)) {
      return;
    }

    sentNotices.push(noticeId);
    this.#save();
  }

  #load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (
        !data ||
        typeof data.notices !== "object" ||
        data.notices === null ||
        Array.isArray(data.notices) ||
        Object.values(data.notices).some(
          (notices) =>
            !Array.isArray(notices) ||
            notices.some((noticeId) => typeof noticeId !== "string"),
        )
      ) {
        throw new Error("Invalid update notices file.");
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
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(this.data, null, 2)}\n`,
      "utf8",
    );
    fs.renameSync(temporaryPath, this.filePath);
  }
}
