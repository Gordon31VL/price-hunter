import fs from "node:fs";
import path from "node:path";
import { EmbedBuilder } from "discord.js";

export const UPDATE_NOTICE_ID = "price-bot-features-2026-11";
export const UPDATE_NOTICE_FILE = path.resolve("update-notice.json");

export function loadUpdateNotice(filePath = UPDATE_NOTICE_FILE) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  if (
    !data ||
    typeof data.title !== "string" ||
    typeof data.description !== "string" ||
    !Array.isArray(data.fields) ||
    data.fields.some(
      (field) =>
        !field ||
        typeof field.name !== "string" ||
        typeof field.value !== "string",
    ) ||
    typeof data.footer !== "string"
  ) {
    throw new Error("Invalid update notice file.");
  }

  return new EmbedBuilder()
    .setColor(data.color)
    .setTitle(data.title)
    .setDescription(data.description)
    .addFields(data.fields)
    .setFooter({ text: data.footer });
}

export function removeUpdateNotice(filePath = UPDATE_NOTICE_FILE) {
  fs.unlinkSync(filePath);
}
