#!/bin/bash
# Build the cputil binary for the current platform (and optionally linux-x64 for Vercel).
# Requires .NET SDK 8+ installed locally.
#
# Usage:
#   ./scripts/build-cputil.sh             # build for current platform
#   ./scripts/build-cputil.sh linux-x64   # cross-build for Vercel target
#   ./scripts/build-cputil.sh all         # build current + linux-x64

set -e

if ! command -v dotnet > /dev/null; then
  echo "Error: dotnet SDK not found. Install from https://dotnet.microsoft.com/download"
  exit 1
fi

REPO_DIR="${REPO_DIR:-/tmp/cloudprnt-sdk}"
WEB_BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"
mkdir -p "$WEB_BIN_DIR"

# Pick RID for current platform
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  CURRENT_RID=osx-arm64 ;;
  Darwin-x86_64) CURRENT_RID=osx-x64 ;;
  Linux-x86_64)  CURRENT_RID=linux-x64 ;;
  Linux-aarch64) CURRENT_RID=linux-arm64 ;;
  *) echo "Unsupported platform: $(uname -sm)"; exit 1 ;;
esac

TARGET="${1:-current}"
case "$TARGET" in
  current) RIDS=("$CURRENT_RID") ;;
  all)     RIDS=("$CURRENT_RID" "linux-x64") ;;
  *)       RIDS=("$TARGET") ;;
esac

# Clone if needed
if [ ! -d "$REPO_DIR" ]; then
  echo "Cloning Star CloudPRNT SDK to $REPO_DIR..."
  git clone --depth 1 https://github.com/star-micronics/cloudprnt-sdk.git "$REPO_DIR"
fi

cd "$REPO_DIR/CloudPRNTSDKSamples/cputil"

for RID in "${RIDS[@]}"; do
  echo
  echo "=== Building cputil for $RID ==="
  dotnet publish -c Release -r "$RID" --self-contained true -p:PublishSingleFile=true 2>&1 | tail -3

  SRC="bin/Release/net8.0/$RID/publish/cputil"
  if [ ! -x "$SRC" ]; then
    echo "Build failed: $SRC not found"
    exit 1
  fi

  case "$RID" in
    osx-*)   DEST="$WEB_BIN_DIR/cputil-darwin-${RID#osx-}" ;;
    linux-*) DEST="$WEB_BIN_DIR/cputil-linux-${RID#linux-}" ;;
    *)       DEST="$WEB_BIN_DIR/cputil-$RID" ;;
  esac

  cp "$SRC" "$DEST"
  chmod +x "$DEST"
  ls -lh "$DEST" | awk '{print " ✓ " $NF " (" $5 ")"}'
done

echo
echo "Done."
