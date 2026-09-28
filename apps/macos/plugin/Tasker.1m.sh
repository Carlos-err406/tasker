#!/bin/bash
# <xbar.title>Tasker</xbar.title>
# <xbar.version>0.1.1</xbar.version>
# <xbar.desc>Local tasks in a SwiftBar popover</xbar.desc>
set -eu
TASKER_PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
TASKER_DATA="${TASKER_SWIFTBAR_DATA_DIR:-$HOME/Library/Application Support/tasker-swiftbar}"
TASKER_RUNTIME="$TASKER_DATA/runtime.json"
TASKER_LABEL="${TASKER_SWIFTBAR_SERVICE_LABEL:-org.tasker-swiftbar.service}"
TASKER_PLIST="${TASKER_SWIFTBAR_LAUNCHAGENT_PATH:-$HOME/Library/LaunchAgents/$TASKER_LABEL.plist}"
TASKER_TARGET="gui/$(/usr/bin/id -u)/$TASKER_LABEL"
TASKER_ICON=$(/usr/bin/base64 -i "$TASKER_PLUGIN_DIR/assets/trayTemplate@2x.png" | /usr/bin/tr -d '\r\n')

service_ready() {
  [ -f "$TASKER_RUNTIME" ] || return 1
  TASKER_ORIGIN=$(/usr/bin/plutil -extract origin raw -o - "$TASKER_RUNTIME" 2>/dev/null) || return 1
  case "$TASKER_ORIGIN" in http://127.0.0.1:[0-9]*) ;; *) return 1 ;; esac
  /usr/bin/curl --noproxy '*' --silent --fail --max-time 1 "$TASKER_ORIGIN/health" >/dev/null
}

if ! service_ready && [ "${TASKER_SWIFTBAR_AUTOSTART:-1}" != '0' ] && [ -f "$TASKER_PLIST" ]; then
  # Recover an unloaded login agent. launchd and the SQLite lock own uniqueness.
  for TASKER_ATTEMPT in {1..15}; do
    if /bin/launchctl print "$TASKER_TARGET" >/dev/null 2>&1; then
      /bin/launchctl kickstart "$TASKER_TARGET" >/dev/null 2>&1 || true
    else
      /bin/launchctl bootstrap "gui/$(/usr/bin/id -u)" "$TASKER_PLIST" >/dev/null 2>&1 || true
    fi
    /bin/sleep 0.2
    if service_ready; then break; fi
  done
fi

if service_ready; then
  TASKER_TOKEN=$(/usr/bin/plutil -extract token raw -o - "$TASKER_RUNTIME")
  TASKER_BUILD=$(/usr/bin/stat -f %m "$TASKER_PLUGIN_DIR/../dist/index.html")
  printf ' | templateImage=%s width=18 height=18 tooltip=Tasker href=%s/?build=%s#%s webview=true webvieww=420 webviewh=620\n' "$TASKER_ICON" "$TASKER_ORIGIN" "$TASKER_BUILD" "$TASKER_TOKEN"
  printf '%s\n' '---' 'Refresh | refresh=true'
else
  printf ' | templateImage=%s width=18 height=18 tooltip="Tasker: service unavailable"\n' "$TASKER_ICON"
  printf '%s\n' '---' 'Service unavailable | color=gray' 'Retry service | refresh=true'
  if [ ! -f "$TASKER_PLIST" ]; then
    printf '%s\n' 'Install the service with pnpm install:macos | color=gray'
  fi
fi
