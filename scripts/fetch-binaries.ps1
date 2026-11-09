# Download yt-dlp + ffmpeg sidecar binaries for Windows into
# src-tauri\binaries\ with the target-triple names Tauri expects.
# Usage (PowerShell):  .\scripts\fetch-binaries.ps1
$ErrorActionPreference = "Stop"
$triple = "x86_64-pc-windows-msvc"
$dir = Join-Path $PSScriptRoot "..\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Location $dir

Invoke-WebRequest "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile "yt-dlp-$triple.exe"
Invoke-WebRequest "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile "ffmpeg.zip"
Expand-Archive "ffmpeg.zip" -DestinationPath "ffmpeg-tmp" -Force
$ff = Get-ChildItem "ffmpeg-tmp" -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
Copy-Item $ff.FullName "ffmpeg-$triple.exe"
Remove-Item "ffmpeg.zip"; Remove-Item "ffmpeg-tmp" -Recurse
Write-Host "Done: yt-dlp-$triple.exe and ffmpeg-$triple.exe in src-tauri\binaries"
