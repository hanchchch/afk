import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { randomBytes } from "crypto";
import { ChannelType, type Message } from "discord.js";
import { STATE_DIR, ACCESS_FILE, APPROVED_DIR } from "./config.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PendingEntry = {
  senderId: string;
  chatId: string;
  createdAt: number;
  expiresAt: number;
  replies: number;
};

export type Access = {
  policy: "pairing" | "allowlist";
  allowFrom: string[];
  pending: Record<string, PendingEntry>;
};

export type GateResult =
  | { action: "deliver"; access: Access }
  | { action: "drop" }
  | { action: "pair"; code: string; isResend: boolean };

// ─── Access file operations ─────────────────────────────────────────────────

function defaultAccess(): Access {
  return { policy: "pairing", allowFrom: [], pending: {} };
}

export function loadAccess(): Access {
  try {
    const raw = readFileSync(ACCESS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Access>;
    return {
      policy: parsed.policy ?? "pairing",
      allowFrom: parsed.allowFrom ?? [],
      pending: parsed.pending ?? {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return defaultAccess();
    try {
      renameSync(ACCESS_FILE, `${ACCESS_FILE}.corrupt-${Date.now()}`);
    } catch {}
    process.stderr.write("access.json corrupt, moved aside. Starting fresh.\n");
    return defaultAccess();
  }
}

export function saveAccess(a: Access): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = ACCESS_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(a, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, ACCESS_FILE);
}

export function pruneExpired(a: Access): boolean {
  const now = Date.now();
  let changed = false;
  for (const [code, p] of Object.entries(a.pending)) {
    if (p.expiresAt < now) {
      delete a.pending[code];
      changed = true;
    }
  }
  return changed;
}

// ─── Gating ─────────────────────────────────────────────────────────────────

export function gate(msg: Message): GateResult {
  const access = loadAccess();
  if (pruneExpired(access)) saveAccess(access);

  const senderId = msg.author.id;
  if (msg.channel.type !== ChannelType.DM) return { action: "drop" };

  if (access.allowFrom.includes(senderId)) return { action: "deliver", access };

  if (access.policy === "allowlist") return { action: "drop" };

  for (const [code, p] of Object.entries(access.pending)) {
    if (p.senderId === senderId) {
      if ((p.replies ?? 1) >= 2) return { action: "drop" };
      p.replies = (p.replies ?? 1) + 1;
      saveAccess(access);
      return { action: "pair", code, isResend: true };
    }
  }

  if (Object.keys(access.pending).length >= 3) return { action: "drop" };

  const code = randomBytes(3).toString("hex");
  const now = Date.now();
  access.pending[code] = {
    senderId,
    chatId: msg.channelId,
    createdAt: now,
    expiresAt: now + 60 * 60 * 1000,
    replies: 1,
  };
  saveAccess(access);
  return { action: "pair", code, isResend: false };
}
