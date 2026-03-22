#!/usr/bin/env bash

set -euo pipefail

REPO_URL="${PORTCTL_REPO_URL:-https://github.com/august-andersen/portctl.git}"
INSTALL_ROOT="${PORTCTL_HOME:-$HOME/.portctl}"
APP_DIR="$INSTALL_ROOT/app"
BIN_PATH="$APP_DIR/bin/portctl.js"

print_step() {
  printf '\n[portctl] %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[portctl] Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

ensure_node_version() {
  local version
  version="$(node -p "process.versions.node")"
  if ! node -e "const [major] = process.versions.node.split('.').map(Number); process.exit(major >= 20 ? 0 : 1)"; then
    printf '[portctl] Node.js 20 or newer is required. Current version: %s\n' "$version" >&2
    printf '[portctl] Install Node.js from https://nodejs.org or with Homebrew: brew install node\n' >&2
    exit 1
  fi
}

install_app() {
  mkdir -p "$INSTALL_ROOT"

  if [ -d "$APP_DIR/.git" ]; then
    print_step "Updating existing install in $APP_DIR"
    git -C "$APP_DIR" pull --ff-only
  else
    print_step "Cloning portctl into $APP_DIR"
    rm -rf "$APP_DIR"
    git clone --depth 1 "$REPO_URL" "$APP_DIR"
  fi
}

install_dependencies() {
  print_step "Installing dependencies"
  (cd "$APP_DIR" && npm install)
}

build_app() {
  print_step "Building portctl"
  (cd "$APP_DIR" && npm run build)
  chmod +x "$BIN_PATH"
}

link_cli() {
  local target_dir=""
  local path_line='export PATH="$HOME/.local/bin:$PATH"'

  if [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
    target_dir="/usr/local/bin"
  elif [ -d "/opt/homebrew/bin" ] && [ -w "/opt/homebrew/bin" ]; then
    target_dir="/opt/homebrew/bin"
  else
    target_dir="$HOME/.local/bin"
    mkdir -p "$target_dir"

    for profile in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile"; do
      if [ ! -f "$profile" ]; then
        continue
      fi

      if ! grep -Fq "$path_line" "$profile"; then
        print_step "Adding $target_dir to PATH in $(basename "$profile")"
        printf '\n%s\n' "$path_line" >>"$profile"
      fi
      break
    done
  fi

  print_step "Linking CLI into $target_dir"
  ln -sf "$BIN_PATH" "$target_dir/portctl"
}

print_success() {
  cat <<EOF

[portctl] Install complete.

Next steps:
  1. portctl start
  2. portctl open

Runtime files:
  - Config: $INSTALL_ROOT/config.json
  - Logs:   $INSTALL_ROOT/logs/daemon.log
EOF
}

main() {
  require_command git
  require_command node
  require_command npm
  ensure_node_version
  install_app
  install_dependencies
  build_app
  link_cli
  print_success
}

main "$@"
