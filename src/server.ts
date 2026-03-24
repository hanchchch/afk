#!/usr/bin/env tsx
/**
 * AFK Discord Channel for Claude Code
 *
 * Two-way MCP channel server that lets you interact with Claude Code
 * through Discord while you're away. Claude notifies you when tasks
 * finish, and you can send feedback/instructions back via Discord DMs.
 */

import { appendFileSync, writeFileSync } from "fs";
import type { Message } from "discord.js";
import { MESSAGES_FILE, RECENT_CHATS_FILE } from "./config.js";
import { gate } from "./access.js";
import { discord, startApprovalPolling } from "./discord.js";
import { connectMcp } from "./mcp.js";
import { tryRead, withLock } from "./files.js";

async function handleInbound(msg: Message): Promise<void> {
  const result = gate(msg);

  if (result.action === "drop") return;

  if (result.action === "pair") {
    const lead = result.isResend ? "Still pending" : "Pairing required";
    try {
      await msg.reply(`${lead} — run in your terminal:\n\n\`pnpm afk pair ${result.code}\``);
    } catch (err) {
      process.stderr.write(`failed to send pairing code: ${err}\n`);
    }
    return;
  }

  // Attachment metadata
  const atts: string[] = [];
  for (const att of msg.attachments.values()) {
    const kb = (att.size / 1024).toFixed(0);
    const safeName = (att.name ?? att.id).replace(/[\[\]\r\n;]/g, "_");
    atts.push(`${safeName} (${att.contentType ?? "unknown"}, ${kb}KB)`);
  }

  const content = msg.content || (atts.length > 0 ? "(attachment)" : "");

  const entry = {
    content,
    chat_id: msg.channelId,
    message_id: msg.id,
    user: msg.author.username,
    user_id: msg.author.id,
    ts: msg.createdAt.toISOString(),
    ...(atts.length > 0
      ? {
          attachment_count: atts.length,
          attachments: atts.join("; "),
        }
      : {}),
  };
  const results = await Promise.allSettled([
    withLock({ file: RECENT_CHATS_FILE, timeout: 5000 }, (file) => {
      writeFileSync(
        file,
        JSON.stringify({
          chat_id: entry.chat_id,
          message_id: entry.message_id,
          user: entry.user,
          user_id: entry.user_id,
          ts: entry.ts,
        }) + "\n",
      );
    }),
    withLock({ file: MESSAGES_FILE, timeout: 5000 }, (file) => {
      if (!tryRead(file)?.includes(msg.id)) {
        appendFileSync(file, JSON.stringify(entry) + "\n");
      }
    }),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      process.stderr.write(`failed to write message to file: ${result.reason}\n`);
    }
  }
}

// ─── Connect MCP ────────────────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  await connectMcp();

  // ─── Shutdown handling ──────────────────────────────────────────────────────

  let shuttingDown = false;
  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write("shutting down\n");
    setTimeout(() => process.exit(0), 2000);
    void Promise.resolve(discord.destroy()).finally(() => process.exit(0));
  }
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  process.on("unhandledRejection", (err) => {
    process.stderr.write(`unhandled rejection: ${err}\n`);
  });
  process.on("uncaughtException", (err) => {
    process.stderr.write(`uncaught exception: ${err}\n`);
  });

  // ─── Discord message handling ───────────────────────────────────────────────

  discord.on("error", (err) => {
    process.stderr.write(`client error: ${err}\n`);
  });

  discord.on("messageCreate", (msg) => {
    if (msg.author.bot) return;
    handleInbound(msg).catch((e) => process.stderr.write(`handleInbound failed: ${e}\n`));
  });

  // ─── Start Discord ──────────────────────────────────────────────────────────

  discord.once("clientReady", (c) => {
    process.stderr.write(`gateway connected as ${c.user.tag}\n`);
  });

  startApprovalPolling();
}
