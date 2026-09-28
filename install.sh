#!/bin/bash
# Tasker user-local installer. Run with bash; macOS ships Bash 3.2.
set -euo pipefail

say() { printf '%s\n' "Tasker: $*"; }
fail() { say "$*" >&2; return 1; }
download() { /usr/bin/curl --fail --location --silent --show-error --retry 3 --connect-timeout 15 --speed-time 30 --speed-limit 1024 --proto '=https' --proto-redir '=https' "$1" -o "$2"; }
valid_version() { [[ "$1" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; }
verify_sha256() {
  local actual
  [[ "$2" =~ ^[a-f0-9]{64}$ ]] || { fail 'Invalid SHA-256 checksum.'; return 1; }
  actual=$(/usr/bin/shasum -a 256 "$1"); actual=${actual%% *}
  [[ "$actual" == "$2" ]] || { fail "Checksum mismatch for $(basename "$1"). Nothing was activated."; return 1; }
}
check_archive() {
  local archive=$1 prefix=$2 item
  /usr/bin/tar -tzf "$archive" > "$archive.entries"
  while IFS= read -r item; do
    case "$item" in "$prefix"|"$prefix/"|"$prefix/"*) ;; *) fail 'Archive contains an unexpected path.'; return 1;; esac
    case "/$item/" in *'/../'*) fail 'Archive contains parent traversal.'; return 1;; esac
  done < "$archive.entries"
  rm -f "$archive.entries"
}
health_check() {
  local attempt origin pid command
  for attempt in {1..60}; do
    if [[ -f "$data/runtime.json" ]]; then
      origin=$(/usr/bin/plutil -extract origin raw -o - "$data/runtime.json" 2>/dev/null || true)
      pid=$(/usr/bin/plutil -extract pid raw -o - "$data/runtime.json" 2>/dev/null || true)
      if [[ "$origin" =~ ^http://127\.0\.0\.1:[0-9]+$ && "$pid" =~ ^[0-9]+$ ]]; then
        command=$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)
        if [[ "$command" == *"$app/apps/macos/dist-service/service/main.js"* ]] && /usr/bin/curl --fail --silent --max-time 1 "$origin/health" >/dev/null; then return 0; fi
      fi
    fi
    /bin/sleep 0.25
  done
  fail 'The new service did not become healthy.'
}
launchctl_tasker() { /bin/launchctl "$@"; }
rollback() {
  say 'Activation failed; restoring the previous service and plugin.'
  launchctl_tasker bootout "gui/$(id -u)/${label:-org.tasker-swiftbar.service}" >/dev/null 2>&1 || true
  if [[ -f "$scratch/previous.plist" ]]; then
    cp -p "$scratch/previous.plist" "$plist"
    local attempt restarted=0
    for ((attempt=0; attempt<20; attempt++)); do
      if launchctl_tasker bootstrap "gui/$(id -u)" "$plist" >/dev/null 2>&1; then restarted=1; break; fi
      /bin/sleep 0.25
    done
    [[ "$restarted" == 1 ]] || say 'Previous service could not restart; its files were restored.'
  else rm -f "$plist"; fi
  if [[ -f "$scratch/previous.plugin" ]]; then cp -p "$scratch/previous.plugin" "$plugin"; else rm -f "$plugin"; fi
}
cleanup() {
  local result=$?
  trap - EXIT
  if [[ "${activating:-0}" == 1 ]]; then rollback; fi
  [[ -z "${scratch:-}" ]] || rm -rf "$scratch"
  [[ "${locked:-0}" != 1 ]] || rmdir "$root/.install-lock" 2>/dev/null || true
  exit "$result"
}
main() {
  local version='' local_archive='' prepare=0 no_open=0 arg arch node_arch node_sha node_dir pnpm_dir
  local asset base expected digest release_dir configured_plugin host_path os_version os_major os_minor
  for arg in "$@"; do
    case "$arg" in
      --help|-h) printf '%s\n' 'Usage: bash install.sh [--version=v0.1.0] [--archive=/absolute/path.tar.gz] [--prepare-only] [--no-open]' 'Re-run to update. Installs private Node/pnpm runtimes; never needs sudo.' 'TASKER_INSTALL_ROOT overrides ~/.local/share/tasker.' 'TASKER_SWIFTBAR_PLUGIN_DIR overrides the SwiftBar plugin directory.'; return 0;;
      --version=*) version=${arg#*=};;
      --archive=*) local_archive=${arg#*=};;
      --prepare-only) prepare=1;;
      --no-open) no_open=1;;
      *) fail "Unknown option: $arg"; return 1;;
    esac
  done
  [[ "$(uname -s)" == Darwin ]] || { fail 'This installer supports macOS only.'; return 1; }
  [[ "$EUID" != 0 ]] || { fail 'Run as your normal macOS user, without sudo.'; return 1; }
  os_version=$(/usr/bin/sw_vers -productVersion)
  os_major=${os_version%%.*}; os_minor=${os_version#*.}; os_minor=${os_minor%%.*}
  if (( os_major < 13 || (os_major == 13 && os_minor < 5) )); then fail 'Tasker requires macOS 13.5 or later.'; return 1; fi
  arch=$(uname -m)
  case "$arch" in
    arm64) node_arch=arm64; node_sha=6e577fd0d9db776db82306629e441a9dace416702622aebdd171c9dfaa41f4d2;;
    x86_64) node_arch=x64; node_sha=fe9c6dbf9c8e1b4443803d75e2a20366e420dae650c747dbb116b22975751baf;;
    *) fail "Unsupported architecture: $arch"; return 1;;
  esac
  root=${TASKER_INSTALL_ROOT:-"$HOME/.local/share/tasker"}
  [[ "$root" == /* && "$root" != / && "$root" != "$HOME" ]] || { fail 'Use an absolute, dedicated TASKER_INSTALL_ROOT.'; return 1; }
  label=${TASKER_SWIFTBAR_SERVICE_LABEL:-org.tasker-swiftbar.service}
  [[ "$label" =~ ^[A-Za-z0-9.-]+$ ]] || { fail 'Invalid service label.'; return 1; }
  data=${TASKER_SWIFTBAR_DATA_DIR:-"$HOME/Library/Application Support/tasker-swiftbar"}
  umask 077
  mkdir -p "$root/versions" "$root/runtimes"
  if ! mkdir "$root/.install-lock" 2>/dev/null; then fail "Another installation is running. If an earlier run was interrupted, remove $root/.install-lock after confirming it stopped."; return 1; fi
  locked=1; activating=0
  scratch=$(mktemp -d "$root/.download.XXXXXX")
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [[ -n "$version" ]] && ! valid_version "$version"; then fail 'Invalid release version.'; return 1; fi
  if [[ -n "$local_archive" ]]; then
    [[ "$local_archive" == /* && -f "$local_archive" && -f "$local_archive.sha256" ]] || { fail 'Local archive needs an absolute path and companion .sha256 file.'; return 1; }
    cp "$local_archive" "$scratch/tasker.tar.gz"; cp "$local_archive.sha256" "$scratch/tasker.sha256"
  else
    if [[ -z "$version" ]]; then
      download 'https://api.github.com/repos/Carlos-err406/tasker/releases/latest' "$scratch/release.json"
      version=$(/usr/bin/plutil -extract tag_name raw -o - "$scratch/release.json")
    fi
    valid_version "$version" || { fail 'Invalid release version returned by GitHub.'; return 1; }
    version=${version#v}
    asset="tasker-swiftbar-$version-macos.tar.gz"
    base="https://github.com/Carlos-err406/tasker/releases/download/v$version"
    say "Downloading Tasker $version…"
    download "$base/$asset" "$scratch/tasker.tar.gz"
    download "$base/$asset.sha256" "$scratch/tasker.sha256"
  fi
  expected=$(awk 'NR==1 {print $1}' "$scratch/tasker.sha256")
  verify_sha256 "$scratch/tasker.tar.gz" "$expected"
  check_archive "$scratch/tasker.tar.gz" tasker-swiftbar
  /usr/bin/tar -xzf "$scratch/tasker.tar.gz" -C "$scratch"
  version=$(/usr/bin/plutil -extract version raw -o - "$scratch/tasker-swiftbar/package.json")
  valid_version "$version" || { fail 'Invalid version in release archive.'; return 1; }
  digest=${expected:0:16}
  release_dir="$root/versions/$version-$digest"
  node_dir="$root/runtimes/node-v26.8.1-darwin-$node_arch"
  if [[ ! -x "$node_dir/bin/node" ]]; then
    say 'Installing a private Node.js runtime…'
    download "https://nodejs.org/dist/v26.8.1/node-v26.8.1-darwin-$node_arch.tar.gz" "$scratch/node.tar.gz"
    verify_sha256 "$scratch/node.tar.gz" "$node_sha"
    check_archive "$scratch/node.tar.gz" "node-v26.8.1-darwin-$node_arch"
    /usr/bin/tar -xzf "$scratch/node.tar.gz" -C "$scratch"
    mv "$scratch/node-v26.8.1-darwin-$node_arch" "$node_dir"
  fi
  export PATH="$node_dir/bin:$PATH"
  [[ "$("$node_dir/bin/node" --version)" == v26.8.1 ]] || { fail 'The managed Node runtime is invalid.'; return 1; }
  pnpm_dir="$root/runtimes/pnpm-10.14.0"
  if [[ ! -f "$pnpm_dir/bin/pnpm.cjs" ]]; then
    say 'Installing a private pnpm…'
    download 'https://registry.npmjs.org/pnpm/-/pnpm-10.14.0.tgz' "$scratch/pnpm.tgz"
    "$node_dir/bin/node" -e 'const fs=require("fs"),crypto=require("crypto");const actual=crypto.createHash("sha512").update(fs.readFileSync(process.argv[1])).digest("base64");if(actual!=="rSenlkG0nD5IGhaoBbqnGBegS74Go40X5g4urug/ahRsamiBJfV5LkjdW6MOfaUqXNpMOZK5zPMz+c4iOvhHSA==")process.exit(1)' "$scratch/pnpm.tgz" || { fail 'pnpm checksum mismatch.'; return 1; }
    check_archive "$scratch/pnpm.tgz" package
    /usr/bin/tar -xzf "$scratch/pnpm.tgz" -C "$scratch"
    mv "$scratch/package" "$pnpm_dir"
  fi
  if [[ ! -f "$release_dir/.prepared" ]]; then
    [[ ! -e "$release_dir" ]] || { fail "Incomplete previous install at $release_dir; move it aside and retry."; return 1; }
    say 'Installing Tasker dependencies…'
    "$node_dir/bin/node" "$pnpm_dir/bin/pnpm.cjs" --dir "$scratch/tasker-swiftbar" install --prod --frozen-lockfile
    touch "$scratch/tasker-swiftbar/.prepared"
    mv "$scratch/tasker-swiftbar" "$release_dir"
  fi
  app=$release_dir
  if [[ "$prepare" == 1 ]]; then say "Prepared $app. Service and SwiftBar were not changed."; return 0; fi
  host_path=${TASKER_SWIFTBAR_APP:-}
  if [[ -z "$host_path" ]]; then
    for arg in "$HOME/Applications/SwiftBar.app" /Applications/SwiftBar.app; do
      if [[ -d "$arg" ]]; then host_path=$arg; break; fi
    done
  fi
  if [[ -z "$host_path" || ! -d "$host_path" ]]; then
    say 'Installing the tested SwiftBar fork in ~/Applications…'
    download 'https://github.com/Carlos-err406/tasker/releases/download/v0.1.0/SwiftBar-headerless-universal.zip' "$scratch/SwiftBar.zip"
    verify_sha256 "$scratch/SwiftBar.zip" '8bf20f30b2eda296a24a70e8d4f0371efc5941dadae2f7ea290caac1c76344f6'
    /usr/bin/ditto -x -k "$scratch/SwiftBar.zip" "$scratch/host"
    /usr/bin/codesign --verify --deep --strict "$scratch/host/SwiftBar.app"
    mkdir -p "$HOME/Applications"
    host_path="$HOME/Applications/SwiftBar.app"
    [[ ! -e "$host_path" ]] || { fail 'SwiftBar appeared during installation; retry to use it.'; return 1; }
    mv "$scratch/host/SwiftBar.app" "$host_path"
    cp "$app/THIRD-PARTY-NOTICES.md" "$HOME/Applications/Tasker-SwiftBar-NOTICE.md"
    say 'This free fork is ad-hoc signed, not Apple-notarized. macOS may require Open Anyway in Privacy & Security.' 
  fi
  configured_plugin=$(/usr/bin/defaults read com.ameba.SwiftBar PluginDirectory 2>/dev/null || true)
  configured_plugin=${configured_plugin/#\~/$HOME}
  plugin_dir=${TASKER_SWIFTBAR_PLUGIN_DIR:-${configured_plugin:-"$HOME/.config/swiftbar"}}
  [[ "$plugin_dir" == /* ]] || { fail 'SwiftBar plugin directory must be absolute.'; return 1; }
  export TASKER_SWIFTBAR_PLUGIN_DIR="$plugin_dir"
  export TASKER_SWIFTBAR_DATA_DIR="$data"
  export TASKER_SWIFTBAR_SERVICE_LABEL="$label"
  agents=${TASKER_SWIFTBAR_LAUNCHAGENT_DIR:-"$HOME/Library/LaunchAgents"}
  plist="$agents/$label.plist"; plugin="$plugin_dir/Tasker.1m.sh"
  if [[ -f "$plugin" ]] && ! /usr/bin/grep -q '# Managed by tasker-swiftbar' "$plugin"; then fail "An unmanaged plugin already exists at $plugin; choose a different plugin directory."; return 1; fi
  [[ ! -f "$plist" ]] || cp -p "$plist" "$scratch/previous.plist"
  [[ ! -f "$plugin" ]] || cp -p "$plugin" "$scratch/previous.plugin"
  if [[ -e "$root/current" && ! -L "$root/current" ]]; then fail "$root/current must be an installer-managed symlink."; return 1; fi
  export TASKER_SWIFTBAR_NO_OPEN="$no_open"
  activating=1
  "$node_dir/bin/node" "$app/scripts/install.mjs"
  health_check
  activating=0
  {
    printf '#!/bin/bash\nset -e\n'
    printf 'export TASKER_SWIFTBAR_SERVICE_LABEL=%q\n' "$label"
    printf 'export TASKER_SWIFTBAR_DATA_DIR=%q\n' "$data"
    printf 'export TASKER_SWIFTBAR_PLUGIN_DIR=%q\n' "$plugin_dir"
    printf 'export TASKER_SWIFTBAR_LAUNCHAGENT_DIR=%q\n' "$agents"
    printf 'exec %q %q --uninstall\n' "$node_dir/bin/node" "$app/scripts/install.mjs"
  } > "$root/uninstall.sh"
  chmod 700 "$root/uninstall.sh"
  # Switch the convenience pointer only after the new service is healthy.
  rm -f "$root/current.new"
  ln -s "$app" "$root/current.new"
  mv -fh "$root/current.new" "$root/current"
  if [[ "$no_open" == 0 ]]; then
    if [[ -z "$configured_plugin" ]]; then /usr/bin/defaults write com.ameba.SwiftBar PluginDirectory -string "$plugin_dir"; fi
    /usr/bin/open "$host_path"
    /usr/bin/open 'swiftbar://refreshallplugins' || true
  fi
  say "Installed Tasker $version. Click its menu-bar icon to get started."
  say 'Run the same installer again to update. Tasks, backups, and Google connection are preserved.'
}
if [[ "${BASH_SOURCE[0]:-}" == "$0" || -z "${BASH_SOURCE[0]:-}" ]]; then main "$@"; fi
