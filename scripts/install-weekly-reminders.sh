#!/bin/bash
# Ставит еженедельный запуск scripts/send-reminders.js через launchd (macOS).
# Запуск по умолчанию: пятница 18:00 по времени этого Mac. Если Mac в это время спал,
# launchd запустит рассылку при пробуждении; если был выключен — пропустит неделю.
#
#   scripts/install-weekly-reminders.sh /путь/до/serviceAccount.json [день 0-6, 0=вс] [час] [минута]
#
# Удалить расписание:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.j3110-survey.reminders.plist

set -euo pipefail

KEY_PATH="${1:?Укажите путь до ключа сервисного аккаунта}"
WEEKDAY="${2:-5}"
HOUR="${3:-18}"
MINUTE="${4:-0}"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEY_PATH="$(cd "$(dirname "$KEY_PATH")" && pwd)/$(basename "$KEY_PATH")"
NODE_BIN="$(command -v node)"
LABEL="com.j3110-survey.reminders"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# Фоновые задания macOS не пускают в Downloads/Documents/Desktop без Full Disk Access.
case "$KEY_PATH" in
  "$HOME/Downloads/"*|"$HOME/Documents/"*|"$HOME/Desktop/"*)
    echo "Ключ лежит в защищённой папке macOS — фоновый запуск не сможет его прочитать."
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
    <string>$PROJECT_DIR/scripts/send-reminders.js</string>
    <string>--key</string>
    <string>$KEY_PATH</string>
    <string>--send</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>$WEEKDAY</integer>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MINUTE</integer>
  </dict>
  <key>StandardOutPath</key><string>$PROJECT_DIR/reminders.local.log</string>
  <key>StandardErrorPath</key><string>$PROJECT_DIR/reminders.local.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Готово: рассылка каждую неделю (день $WEEKDAY, $HOUR:$(printf %02d "$MINUTE")). Лог: $PROJECT_DIR/reminders.local.log"
