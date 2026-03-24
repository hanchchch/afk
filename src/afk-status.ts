import { readFileSync, existsSync, writeFileSync } from "fs";
import { AFK_STATUS_FILE } from "./config.js";

export type AfkStatus = {
  status: "away" | "back";
};

const DEFAULT_AFK_STATUS: AfkStatus = {
  status: "back",
};

export function readAfkStatus(): AfkStatus {
  if (!existsSync(AFK_STATUS_FILE)) {
    return DEFAULT_AFK_STATUS;
  }
  const raw = readFileSync(AFK_STATUS_FILE, "utf-8").trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`failed to parse conversation status: ${error}\n`);
    return DEFAULT_AFK_STATUS;
  }
}

export function writeAfkStatus(status: AfkStatus): void {
  writeFileSync(AFK_STATUS_FILE, JSON.stringify(status));
}
