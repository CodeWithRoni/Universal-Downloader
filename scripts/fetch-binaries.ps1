# Download yt-dlp + ffmpeg for Windows into resources\bin\.
# The Electron app bundles whatever is in resources\bin\ (electron-builder
# extraResources), and in development the main process looks there too.
# Usage (PowerShell):  .\scripts\fetch-binaries.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "resources\bin"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Invoke-WebRequest "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile (Join-Path $dir "yt-dlp.exe")
# ffmpeg: a single ready-to-run binary from the ffmpeg-static project's releases.
Invoke-WebRequest "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64" -OutFile (Join-Path $dir "ffmpeg.exe")
Write-Host "Done: yt-dlp.exe and ffmpeg.exe in resources\bin"
