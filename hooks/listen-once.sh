#!/bin/bash

input=$(cat)

status=$(echo "$input" | jq -r '.status // "unknown"')
loop_count=$(echo "$input" | jq -r '.loop_count // 0')

if [ "$loop_count" = 0 ] && [ "$user_status" = "away" ]; then
  echo '{ "followup_message": "The user is now AFK. Send them a message with a brief status update: what and how you have done so far, what you are working on now, any questions you have, and what is left to do." }'
  exit 0
fi

node_path=<node_path>
script_dir="$(cd "$(dirname "$0")" && pwd)"

user_status=$($node_path "$script_dir/../dist/commands/afk.js" check)
incoming_message=$($node_path "$script_dir/../dist/commands/afk.js" listen-once --hook-mode )

if [ -z "$incoming_message" ]; then
  echo '{}'
  exit 0
fi

echo "$incoming_message"
