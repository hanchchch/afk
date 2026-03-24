#!/bin/bash
set -e

REPO="hanchchch/afk"
INSTALL_DIR="$HOME/.afk/app"

echo "Installing afk..."

# ── Check dependencies ──────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo "error: node is required. Install it from https://nodejs.org" >&2
  exit 1
fi

if ! command -v pnpm &>/dev/null; then
  echo "pnpm not found, installing via corepack..."
  corepack enable && corepack prepare pnpm@latest --activate
fi

# ── Clone / update ──────────────────────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating existing installation..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  rm -rf "$INSTALL_DIR"
  git clone "https://github.com/$REPO.git" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── Build ────────────────────────────────────────────────────────────────────

pnpm install --frozen-lockfile
pnpm build

# ── Shell alias ──────────────────────────────────────────────────────────────

NODE_PATH="$(command -v node)"
AFK_CMD="$INSTALL_DIR/dist/commands/afk.js"
ALIAS_LINE="alias afk='\"$NODE_PATH\" \"$AFK_CMD\"'"

add_alias() {
  local rc="$1"
  if [ -f "$rc" ] && grep -qF "alias afk=" "$rc"; then
    sed -i.bak "/alias afk=/d" "$rc" && rm -f "$rc.bak"
  fi
  echo "$ALIAS_LINE" >>"$rc"
}

SHELL_NAME="$(basename "$SHELL")"
case "$SHELL_NAME" in
  zsh)  add_alias "$HOME/.zshrc" ;;
  bash) add_alias "$HOME/.bashrc" ;;
  *)    echo "Add this to your shell rc: $ALIAS_LINE" ;;
esac

# ── Init ─────────────────────────────────────────────────────────────────────

echo ""
"$NODE_PATH" "$AFK_CMD" init

echo ""
echo "Run 'source ~/.${SHELL_NAME}rc' or open a new terminal, then type 'afk' to get started."
