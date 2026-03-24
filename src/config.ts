import { existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ─── State paths ────────────────────────────────────────────────────────────

export const STATE_DIR = process.env.AFK_STATE_DIR ?? join(homedir(), ".afk");
mkdirSync(STATE_DIR, { recursive: true });

export const CONFIG_FILE = join(STATE_DIR, "config.json");
export const ACCESS_FILE = join(STATE_DIR, "access.json");
export const APPROVED_DIR = join(STATE_DIR, "approved");
export const INBOX_DIR = join(STATE_DIR, "inbox");
export const RECENT_CHATS_FILE = join(STATE_DIR, "recent-chats.json");
export const MESSAGES_FILE = join(STATE_DIR, "messages.jsonl");
export const AFK_STATUS_FILE = join(STATE_DIR, "afk-status.json");

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_CHUNK = 2000;

// ─── Token (passed via .mcp.json env) ───────────────────────────────────────

interface Config {
  discord_bot_token: string;
}

export function getConfig(): Config {
  if (existsSync(CONFIG_FILE)) {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  }
  return {
    discord_bot_token: process.env.DISCORD_BOT_TOKEN ?? "",
  };
}
