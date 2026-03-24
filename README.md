# afk

Two-way Discord bridge for AI coding agents. Get notified on your phone when tasks finish, and send feedback back without touching your terminal.

```
you (Discord)  <──>  afk (MCP server + stop hook)  <──>  Cursor / Claude Code
```

When the agent finishes a task, the stop hook fires and sends you a status update on Discord. You reply on Discord, and the agent picks up your message and keeps working.

## Usage

Toggle your status before you step away:

```bash
afk          # toggle between away/back
afk away     # explicitly set away
afk back     # explicitly set back
```

While you're away, the agent will message you on Discord whenever it finishes a task. Reply on Discord to send instructions back.

## Quick install

```bash
/bin/bash -c "$(curl -fsSL https://github.com/hanchchch/afk/releases/download/v0.0.0/install.sh)"
```

This clones the repo, builds it, adds an `afk` shell alias, and runs `afk init` to walk you through setup.

### Pairing

The first time you DM the bot, it generates a pairing code. Run the command it shows to approve the connection:

```bash
afk pair <code>
```

This links your Discord user ID so the bot only accepts messages from you.

s### Manual installation

```bash
git clone https://github.com/hanchchch/afk.git ~/.afk/app
cd ~/.afk/app
pnpm install
pnpm build
```

Then run the interactive setup:

```bash
node dist/commands/afk.js init
```

The init wizard will:

1. Ask for your Discord bot token (saved to `~/.afk/config.json`)
2. Ask which client you use (Cursor or Claude Code)
3. Ask the scope (user-wide or per-project)
4. Write the MCP server and stop hook configs to the right files

If you leave the client blank, it prints the JSON configs so you can paste them manually.

## Prerequisites

- **Node.js** >= 18
- **A Discord bot** with the Message Content intent enabled

### Creating a Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application
2. Go to **Bot** and click **Reset Token** to get your bot token
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**
4. Go to **OAuth2 > URL Generator**, select the `bot` scope with `Send Messages` and `Read Message History` permissions
5. Open the generated URL to invite the bot to your server (or just DM it directly)

## How it works

**afk** has two components that get installed into your coding agent:

### MCP server

Gives the agent tools to communicate with you on Discord:

| Tool | Description |
|---|---|
| `reply` | Send a message (with optional file attachments) |
| `react` | Add an emoji reaction |
| `edit_message` | Edit a previously sent message |
| `fetch_messages` | Read recent messages from a channel |
| `get_recent_chat` | Get the most recent chat for unprompted messages |
| `download_attachment` | Download files you send via Discord |

### Stop hook

Runs every time the agent finishes responding:

1. On the first stop, it tells the agent you're AFK and to send a status update
2. On subsequent stops, it polls for your Discord replies and feeds them back as follow-up messages so the agent keeps working

The hook only fires when your status is set to "away".


### CLI reference

```
afk [status]                  Toggle or set status (away/back)
afk init                      Interactive setup wizard
afk start                     Start the MCP server (called by your client)
afk check                     Print current status
afk pair <code>               Approve a Discord pairing
afk listen-once               Poll for one inbound message
afk config set <key> <value>  Set a config value
```

### Config

Config is stored in `~/.afk/config.json`. The main key is:

| Key | Description |
|---|---|
| `discord_bot_token` | Your Discord bot token |

Set it via the init wizard or directly:

```bash
afk config set discord_bot_token <token>
```

## License

MIT
