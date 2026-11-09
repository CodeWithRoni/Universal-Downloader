#!/usr/bin/env bash
# Download yt-dlp + ffmpeg into resources/bin/ for a target platform.
# The Electron app bundles whatever is in resources/bin/ (electron-builder
# extraResources), and in development the main process looks there too.
#
# Usage:  ./scripts/fetch-binaries.sh [linux|mac] [x64|arm64]
#         (no arguments = this machine)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p resources/bin

OS="${1:-}"
ARCH="${2:-}"
if [ -z "$OS" ]; then
  case "$(uname -s)" in
    Linux) OS=linux ;;
    Darwin) OS=mac ;;
    *) echo "Unsupported OS here — on Windows use scripts/fetch-binaries.ps1"; exit 1 ;;
  esac
fi
if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    x86_64|amd64) ARCH=x64 ;;
    arm64|aarch64) ARCH=arm64 ;;
    *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
  esac
fi

# ffmpeg binaries come from the ffmpeg-static project's GitHub releases —
# one ready-to-run file per platform/arch, no archives to unpack.
FF_TAG="b6.0"
case "$OS-$ARCH" in
  linux-x64)   YT="yt-dlp_linux";         FF="ffmpeg-linux-x64" ;;
  linux-arm64) YT="yt-dlp_linux_aarch64"; FF="ffmpeg-linux-arm64" ;;
  mac-x64)     YT="yt-dlp_macos";         FF="ffmpeg-darwin-x64" ;;
  mac-arm64)   YT="yt-dlp_macos";         FF="ffmpeg-darwin-arm64" ;;
  *) echo "Unsupported target: $OS-$ARCH"; exit 1 ;;
esac

curl -fL --retry 5 --retry-delay 5 --retry-all-errors -o resources/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YT"
curl -fL --retry 5 --retry-delay 5 --retry-all-errors -o resources/bin/ffmpeg "https://github.com/eugeneware/ffmpeg-static/releases/download/$FF_TAG/$FF"
chmod +x resources/bin/yt-dlp resources/bin/ffmpeg
echo "Done: resources/bin/yt-dlp ($YT) + resources/bin/ffmpeg ($FF)"
