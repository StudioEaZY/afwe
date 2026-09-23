#!/usr/bin/env bash
# Universal installer for AFWE (Linux / macOS)
# Usage: curl -fsSL https://raw.githubusercontent.com/StudioEaZY/afwe/main/scripts/install.sh | bash

set -euo pipefail

REPO="StudioEaZY/afwe"
INSTALL_DIR="${AFWE_INSTALL_DIR:-$HOME/.afwe/bin}"

detect_target() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    linux)
      case "$arch" in
        x86_64) echo "x86_64-unknown-linux-gnu" ;;
        aarch64|arm64) echo "aarch64-unknown-linux-gnu" ;;
        *) echo "unsupported" ;;
      esac
      ;;
    darwin)
      case "$arch" in
        x86_64) echo "x86_64-apple-darwin" ;;
        arm64|aarch64) echo "aarch64-apple-darwin" ;;
        *) echo "unsupported" ;;
      esac
      ;;
    *)
      echo "unsupported"
      ;;
  esac
}

main() {
  echo "▶ Detecting platform..."
  TARGET="$(detect_target)"

  if [ "$TARGET" = "unsupported" ]; then
    echo "Error: Unsupported OS/Architecture: $(uname -s) $(uname -m)"
    echo "You can build from source using: cargo install --git https://github.com/StudioEaZY/afwe crates/afwe-cli"
    exit 1
  fi

  echo "  Detected target: $TARGET"
  mkdir -p "$INSTALL_DIR"

  # Find latest release tag or fallback to v0.1.0
  TAG="${AFWE_VERSION:-v0.1.0}"
  DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/afwe-$TARGET"

  echo "▶ Downloading AFWE ($TAG) from GitHub Releases..."
  TEMP_BIN="$(mktemp)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_BIN"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TEMP_BIN" "$DOWNLOAD_URL"
  else
    echo "Error: Neither curl nor wget found."
    exit 1
  fi

  chmod +x "$TEMP_BIN"
  mv "$TEMP_BIN" "$INSTALL_DIR/afwe"

  echo "✓ Installed successfully to $INSTALL_DIR/afwe"

  # Check if in PATH
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
      echo ""
      echo "⚠ Add the installation directory to your PATH:"
      echo "  export PATH=\"\$PATH:$INSTALL_DIR\""
      echo "  (Add this to your ~/.bashrc or ~/.zshrc)"
      ;;
  esac

  echo ""
  echo "Run 'afwe --version' or 'afwe init' to get started!"
}

main "$@"
