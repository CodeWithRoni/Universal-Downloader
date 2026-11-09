#!/usr/bin/env bash
# Download yt-dlp + ffmpeg sidecar binaries for THIS machine into
# src-tauri/binaries/ with the target-triple names Tauri expects.
# Usage:  ./scripts/fetch-binaries.sh
set -euo pipefail
mkdir -p "$(dirname "$0")/../src-tauri/binaries"
cd "$(dirname "$0")/../src-tauri/binaries"

OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS" in
  Linux)
    if [ "$ARCH" = "x86_64" ]; then TRIPLE="x86_64-unknown-linux-gnu"; YT="yt-dlp_linux"; FF="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
    else TRIPLE="aarch64-unknown-linux-gnu"; YT="yt-dlp_linux_aarch64"; FF="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz"; fi
    curl -L -o "yt-dlp-$TRIPLE" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YT"
    curl -L -o ffmpeg.tar.xz "$FF"
    tar -xf ffmpeg.tar.xz --strip-components=1 --wildcards '*/ffmpeg'
    mv ffmpeg "ffmpeg-$TRIPLE"; rm ffmpeg.tar.xz
    ;;
  Darwin)
    if [ "$ARCH" = "arm64" ]; then TRIPLE="aarch64-apple-darwin"; else TRIPLE="x86_64-apple-darwin"; fi
    curl -L -o "yt-dlp-$TRIPLE" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    curl -L -o ffmpeg.zip "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
    unzip -o ffmpeg.zip; mv ffmpeg "ffmpeg-$TRIPLE"; rm ffmpeg.zip
    ;;
  *) echo "Unsupported OS here — on Windows use scripts/fetch-binaries.ps1"; exit 1;;
esac
chmod +x "yt-dlp-$TRIPLE" "ffmpeg-$TRIPLE"
echo "Done: src-tauri/binaries/yt-dlp-$TRIPLE and ffmpeg-$TRIPLE"
