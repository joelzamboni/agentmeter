#!/bin/sh
# Installs the latest agentmeter release into ~/.local/bin (or $AGENTMETER_INSTALL_DIR).
#
#   curl -fsSL https://joelzamboni.github.io/agentmeter/install.sh | sh
#   curl -fsSL https://joelzamboni.github.io/agentmeter/install.sh | sh -s -- --version 0.1.0
#
# Picks the binary for this OS and CPU, verifies its SHA-256 against the
# checksum published beside it, and installs it atomically.
set -eu

REPO="joelzamboni/agentmeter"
INSTALL_DIR="${AGENTMETER_INSTALL_DIR:-$HOME/.local/bin}"
VERSION=""

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift ;;
    --dir) INSTALL_DIR="$2"; shift ;;
    -h|--help)
      sed -n '2,9p' "$0" 2>/dev/null || echo "usage: install.sh [--version X.Y.Z] [--dir PATH]"
      exit 0 ;;
    *) echo "install.sh: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

need curl
need uname

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) die "unsupported OS: $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac
asset="agentmeter-$os-$arch"

if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)
  [ -n "$VERSION" ] || die "could not determine the latest release"
fi
VERSION=${VERSION#v}
base="https://github.com/$REPO/releases/download/v$VERSION"

if command -v sha256sum >/dev/null 2>&1; then
  sum() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sum() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die "sha256sum or shasum is required"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

say "Downloading agentmeter $VERSION ($asset)…"
curl -fsSL "$base/$asset" -o "$tmp/$asset" || die "download failed: $base/$asset"
curl -fsSL "$base/$asset.sha256" -o "$tmp/$asset.sha256" || die "checksum missing for $asset"

expected=$(cut -d' ' -f1 < "$tmp/$asset.sha256" | tr 'A-F' 'a-f')
actual=$(sum "$tmp/$asset")
[ "$expected" = "$actual" ] || die "checksum mismatch (expected $expected, got $actual)"

mkdir -p "$INSTALL_DIR"
chmod 755 "$tmp/$asset"
mv -f "$tmp/$asset" "$INSTALL_DIR/agentmeter"
say "Installed agentmeter $VERSION to $INSTALL_DIR/agentmeter"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) say "Note: $INSTALL_DIR is not on your PATH. Add it, for example:"
     say "  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac
