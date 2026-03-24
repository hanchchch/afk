#!/usr/bin/env tsx
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { readAfkStatus, writeAfkStatus } from "../afk-status.js";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync, existsSync } from "fs";
import { createInterface } from "readline";
import { resolve, dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { APPROVED_DIR, CONFIG_FILE, getConfig, MESSAGES_FILE, STATE_DIR } from "../config.js";
import { loadAccess, pruneExpired, saveAccess } from "../access.js";
import { tryRead, withLock } from "../files.js";
import { discord, fetchAllowedChannel } from "../discord.js";
import { startServer } from "../server.js";

function toggleStatus(explicit?: string): void {
  let status: "away" | "back" | null = null;

  if (!explicit) {
    const existing = readAfkStatus();
    status = existing.status !== "away" ? "away" : "back";
  } else if (explicit === "away" || explicit === "back") {
    status = explicit;
  }

  if (!status) {
    process.stderr.write("invalid status\n");
    process.exit(1);
  }
  writeAfkStatus({ status });
  process.stderr.write(`status set to ${status}\n`);
  process.exit(0);
}

const POLL_INTERVAL_MS = 500;

export async function listenOnce(timeout?: number): Promise<string | null> {
  const startTime = Date.now();
  while (timeout === undefined || Date.now() - startTime < timeout) {
    const afkStatus = readAfkStatus();
    if (afkStatus.status !== "away") {
      process.stderr.write("user is not away\n");
      process.exit(0);
    }

    const raw = await withLock({ file: MESSAGES_FILE, timeout: 5000 }, (file) => {
      const raw = tryRead(file);
      if (raw) {
        unlinkSync(file);
      }
      return raw;
    });

    if (raw) {
      return raw.trim();
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return null;
}

function pair(code: string): void {
  const access = loadAccess();
  pruneExpired(access);
  const entry = access.pending[code];
  if (!entry) {
    process.stderr.write(`No pending pairing with code: ${code}\n`);
    process.exit(1);
  }
  if (!access.allowFrom.includes(entry.senderId)) {
    access.allowFrom.push(entry.senderId);
  }
  mkdirSync(APPROVED_DIR, { recursive: true });
  writeFileSync(`${APPROVED_DIR}/${entry.senderId}`, entry.chatId);
  delete access.pending[code];
  saveAccess(access);
  process.stdout.write(`Paired Discord user ${entry.senderId}. They'll get a confirmation.\n`);
  process.exit(0);
}

async function configSet(key: string, value: string): Promise<void> {
  await withLock({ file: CONFIG_FILE, timeout: 5000 }, (file) => {
    let config: Record<string, string> = {};
    if (existsSync(file)) {
      config = JSON.parse(tryRead(file) ?? "{}");
    }
    config[key] = value;
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  });
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function readJson(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function writeJson(path: string, data: Record<string, any>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  process.stderr.write(`  wrote ${path}\n`);
}

async function init(): Promise<void> {
  const config = getConfig();

  if (config.discord_bot_token) {
    const token = await prompt("Discord bot token (leave blank to keep existing): ");
    if (token) {
      await configSet("discord_bot_token", token);
    }
  } else {
    const token = await prompt("Discord bot token (leave blank to add later): ");
    if (token) {
      await configSet("discord_bot_token", token);
    } else {
      process.stderr.write("no token provided, add later with `afk config set discord_bot_token <token>`\n");
    }
  }

  const nodePath = process.execPath;
  const thisFile = fileURLToPath(import.meta.url);
  const afkRoot = resolve(dirname(thisFile), "../..");
  const entryPoint = resolve(afkRoot, "dist/commands/afk.js");

  const hookTemplate = resolve(afkRoot, "hooks/listen-once.sh");
  const hookOut = resolve(afkRoot, "dist/listen-once.sh");
  const hookSrc = readFileSync(hookTemplate, "utf-8");
  const hookRendered = hookSrc.replace("<node_path>", nodePath);
  mkdirSync(dirname(hookOut), { recursive: true });
  writeFileSync(hookOut, hookRendered, { mode: 0o755 });

  let autoInstall = true;
  const client = await prompt("Client [cursor/claude-code] (leave blank for manual config): ");
  if (client && client !== "cursor" && client !== "claude-code") {
    process.stderr.write("invalid client, expected 'cursor' or 'claude-code'\n");
    process.exit(1);
  }
  if (!client) {
    autoInstall = false;
  }

  let targetRoot = "";
  if (autoInstall) {
    const scope = await prompt("Scope [user/project] (leave blank for manual config): ");
    if (scope && scope !== "user" && scope !== "project") {
      process.stderr.write("invalid scope, expected 'user' or 'project'\n");
      process.exit(1);
    }
    if (scope === "project") {
      targetRoot = await prompt(`Project root (leave blank for manual config): `);
      if (!targetRoot) {
        autoInstall = false;
      } else {
        targetRoot = resolve(targetRoot);
      }
    } else if (scope === "user") {
      targetRoot = homedir();
    } else {
      autoInstall = false;
    }
  }

  const mcpServerEntry = {
    command: nodePath,
    args: [entryPoint, "start"],
  };

  let mcpPath: string;
  let hooksPath: string;
  let mcpContent: Record<string, any> = {};
  let hooksContent: Record<string, any> = {};

  if (client === "cursor") {
    mcpPath = join(targetRoot, ".cursor", "mcp.json");
    hooksPath = join(targetRoot, ".cursor", "hooks.json");

    mcpContent = autoInstall ? readJson(mcpPath) : {};
    mcpContent.mcpServers = mcpContent.mcpServers ?? {};
    mcpContent.mcpServers.afk = mcpServerEntry;

    hooksContent = autoInstall ? readJson(hooksPath) : {};
    hooksContent.hooks = hooksContent.hooks ?? {};
    hooksContent.hooks.stop = hooksContent.hooks.stop ?? [];
    const existing = hooksContent.hooks.stop as any[];
    if (!existing.some((h: any) => h.command === hookOut)) {
      existing.push({ command: hookOut, timeout: 3600 });
    }
  } else if (client === "claude-code") {
    mcpPath = join(targetRoot, ".claude.json");
    hooksPath = join(targetRoot, ".claude", "settings.json");

    mcpContent = autoInstall ? readJson(mcpPath) : {};
    mcpContent.mcpServers = mcpContent.mcpServers ?? {};
    mcpContent.mcpServers.afk = mcpServerEntry;

    hooksContent = autoInstall ? readJson(hooksPath) : {};
    hooksContent.hooks = hooksContent.hooks ?? {};
    hooksContent.hooks.Stop = hooksContent.hooks.Stop ?? [];
    const existing = hooksContent.hooks.Stop as any[];
    if (!existing.some((g: any) => g.hooks?.some((h: any) => h.command === hookOut))) {
      existing.push({ hooks: [{ type: "command", command: hookOut, timeout: 3600 }] });
    }
  } else {
    mcpPath = "";
    hooksPath = "";
    hooksContent = { hooks: { stop: [{ type: "command", command: hookOut, timeout: 3600 }] } };
    mcpContent = { mcpServers: { afk: mcpServerEntry } };
  }

  if (autoInstall && mcpPath && hooksPath) {
    writeJson(mcpPath, mcpContent);
    writeJson(hooksPath, hooksContent);
  } else {
    process.stderr.write(`\nAdd to mcp json:\n\n`);
    process.stdout.write(JSON.stringify(mcpContent, null, 2) + "\n");
    process.stderr.write(`\nAdd to hooks json:\n\n`);
    process.stdout.write(JSON.stringify(hooksContent, null, 2) + "\n");
  }

  process.stderr.write("\nWhenever you go out, type `afk` in your terminal. Run it again when you're back.\n");
  process.exit(0);
}

yargs(hideBin(process.argv))
  .scriptName("afk")
  .command(
    ["$0 [status]"],
    "Toggle or set conversation status (away/back)",
    (y) =>
      y.positional("status", {
        type: "string",
        choices: ["away", "back"] as const,
        describe: "Explicit status to set; omit to toggle",
      }),
    (argv) => {
      toggleStatus(argv.status);
    },
  )
  .command("check", "Check if the user is AFK", {}, async () => {
    const afkStatus = readAfkStatus();
    process.stdout.write(afkStatus.status + "\n");
    process.exit(0);
  })
  .command("init", "Set up bot token and print MCP config", {}, async () => {
    await init();
  })
  .command("start", "Start the server", {}, async () => {
    await startServer();
  })
  .command(
    "pair <code>",
    "Approve a pending Discord pairing request",
    (y) =>
      y.positional("code", {
        type: "string",
        demandOption: true,
        describe: "Pairing code shown in Discord",
      }),
    (argv) => {
      pair(argv.code as string);
    },
  )
  .command(
    "listen-once",
    "Poll for one inbound message then exit",
    (y) =>
      y.option("hook-mode", {
        type: "boolean",
        default: false,
        describe: "Format output for hook consumption",
      }),
    async (argv) => {
      try {
        discord.login(getConfig().discord_bot_token).catch((err) => {
          process.stderr.write(`login failed: ${err}\n`);
          process.exit(1);
        });

        let message = await listenOnce();
        if (!message) {
          process.exit(0);
        }

        if (argv.hookMode) {
          const parsed = JSON.parse(message);
          const chatId = parsed.chat_id;
          const ch = await fetchAllowedChannel(chatId);
          await ch.sendTyping();
          const followupMessage = {
            followup_message:
              `${parsed.content}\n\n` +
              `reply using mcp tool "reply" when you're done. ` +
              `chat_id: ${chatId}, message_id: ${parsed.message_id}, user_id: ${parsed.user_id}, user: ${parsed.user}`,
          };
          message = JSON.stringify(followupMessage);
        }
        process.stdout.write(message + "\n");
        process.exit(0);
      } catch (error) {
        process.stderr.write(`failed to listen once: ${error}\n`);
        process.exit(1);
      }
    },
  )
  .command(
    "config set <key> <value>",
    "Set a config value",
    (y) =>
      y
        .positional("key", {
          type: "string",
          demandOption: true,
          describe: "Config key (e.g. discord_bot_token)",
        })
        .positional("value", {
          type: "string",
          demandOption: true,
          describe: "Value to store",
        }),
    async (argv) => {
      await configSet(argv.key as string, argv.value as string);
      process.stdout.write(`config.${argv.key} set\n`);
      process.exit(0);
    },
  )
  .strict()
  .help()
  .parse();
