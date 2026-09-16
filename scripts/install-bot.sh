#!/bin/bash
# Запускает Telegram-бота в фоне через launchd (macOS): стартует при входе в систему,
# перезапускается при падении, работает, пока Mac включён. Ресурсов почти не ест.
#
#   scripts/install-bot.sh /путь/до/serviceAccount.json
#
# Остановить и убрать:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.j3110-survey.bot.plist

set -euo pipefail

KEY_PATH="${1:?Укажите путь до ключа сервисного аккаунта}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEY_PATH="$(cd "$(dirname "$KEY_PATH")" && pwd)/$(basename "$KEY_PATH")"
NODE_BIN="$(command -v node)"
LABEL="com.j3110-survey.bot"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# Фоновые задания macOS не пускают в Downloads/Documents/Desktop без Full Disk Access.
case "$KEY_PATH" in
  "$HOME/Downloads/"*|"$HOME/Documents/"*|"$HOME/Desktop/"*)
    echo "Ключ лежит в защищённой папке macOS — фоновый бот не сможет его прочитать."
    echo "Перенесите его, например: mkdir -p ~/.config/j3110-survey && mv \"$KEY_PATH\" ~/.config/j3110-survey/"
    exit 1
    ;;
esac

for f in "$PROJECT_DIR/telegram.local.json" "$PROJECT_DIR/codes.local.json" "$PROJECT_DIR/roster.local.js" "$KEY_PATH"; do
  [ -f "$f" ] || { echo "Не найден $f"; exit 1; }
done

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$PROJECT_DIR/scripts/telegram-bot.js</string>
    <string>run</string>
    <string>--key</string>
    <string>$KEY_PATH</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$PROJECT_DIR/bot.local.log</string>
  <key>StandardErrorPath</key><string>$PROJECT_DIR/bot.local.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Бот запущен и будет стартовать сам при входе в систему. Лог: $PROJECT_DIR/bot.local.log"
