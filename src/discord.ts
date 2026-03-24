import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import { readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { APPROVED_DIR, getConfig } from "./config.js";
import { loadAccess } from "./access.js";

// ─── Discord client ─────────────────────────────────────────────────────────

export const discord = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ─── Approval polling ───────────────────────────────────────────────────────

export function startApprovalPolling(): void {
  setInterval(checkApprovals, 5000).unref();
}

function checkApprovals(): void {
  let files: string[];
  try {
    files = readdirSync(APPROVED_DIR);
  } catch {
    return;
  }
  for (const senderId of files) {
    const file = join(APPROVED_DIR, senderId);
    let dmChannelId: string;
    try {
      dmChannelId = readFileSync(file, "utf8").trim();
    } catch {
      rmSync(file, { force: true });
      continue;
    }
    if (!dmChannelId) {
      rmSync(file, { force: true });
      continue;
    }
    void (async () => {
      try {
        const ch = await discord.channels.fetch(dmChannelId);
        if (ch && ch.isTextBased() && "send" in ch) {
          await ch.send("Paired! You can now talk through me.");
        }
      } catch (err) {
        process.stderr.write(`approval confirm failed: ${err}\n`);
      }
      rmSync(file, { force: true });
    })();
  }
}

// ─── Outbound gate ──────────────────────────────────────────────────────────

export async function fetchAllowedChannel(id: string) {
  const ch = await discord.channels.fetch(id);
  if (!ch || !ch.isTextBased()) {
    throw new Error(`channel ${id} not found or not text-based`);
  }
  const access = loadAccess();
  if (ch.type === ChannelType.DM) {
    const recipientId = (ch as any).recipientId as string | undefined;
    if (recipientId && access.allowFrom.includes(recipientId)) return ch;
    throw new Error(`channel ${id} is not allowlisted`);
  }
  throw new Error(`only DM channels are supported`);
}

// ─── Track sent messages ────────────────────────────────────────────────────

const recentSentIds = new Set<string>();

export function noteSent(id: string): void {
  recentSentIds.add(id);
  if (recentSentIds.size > 200) {
    const first = recentSentIds.values().next().value;
    if (first) recentSentIds.delete(first);
  }
}
