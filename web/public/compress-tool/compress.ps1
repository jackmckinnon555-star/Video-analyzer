# TRA Video Analyzer — local pre-compression (Windows PowerShell)
# Usage:
#   .\compress.ps1 "C:\path\to\video.mp4"
# Or drag-drop a video onto this script in Explorer.
#
# Produces <50 MB output ready for https://video-analyzer-tra.netlify.app
# Identical settings to the in-browser compressor so results are interchangeable.

[CmdletBinding()]
param(
  [Parameter(Position = 0, Mandatory = $false)]
  [string]$InputFile
)

$ErrorActionPreference = "Stop"

# ---- Constants (must match web/src/lib/compress.ts) ----
$TargetBytes        = 47 * 1024 * 1024   # 47 MB, leaves headroom under 50 MB cap
$UploadCapBytes     = 50 * 1024 * 1024
$AudioBitrateKbps   = 32
$MinVideoBitrateKbps = 100
$VideoMaxWidth      = 640

function Write-Section($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Fail($msg) {
  Write-Host "ERROR: $msg" -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

# ---- Resolve input ----
if (-not $InputFile) {
  Write-Host "TRA Video Analyzer — local pre-compression"
  Write-Host ""
  $InputFile = Read-Host "Drag your video file here, then press Enter"
  $InputFile = $InputFile.Trim('"').Trim()
}
if (-not (Test-Path $InputFile)) { Fail "File not found: $InputFile" }
$in = (Get-Item $InputFile).FullName

# ---- ffmpeg sanity check ----
$ffmpeg  = (Get-Command ffmpeg -ErrorAction SilentlyContinue)
$ffprobe = (Get-Command ffprobe -ErrorAction SilentlyContinue)
if (-not $ffmpeg) {
  Fail "ffmpeg not found in PATH. Install it: https://ffmpeg.org/download.html  (or `winget install Gyan.FFmpeg`)"
}
if (-not $ffprobe) { Fail "ffprobe not found in PATH (comes bundled with ffmpeg)" }

Write-Section "Probing duration"
$durationSeconds = [double](& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $in)
if (-not $durationSeconds -or $durationSeconds -le 0) { Fail "Could not read video duration" }
$durationHuman = "{0}m {1}s" -f ([int]($durationSeconds / 60)), ([int]($durationSeconds % 60))
Write-Host "Duration: $durationHuman"

# ---- Bitrate budget ----
$totalBudgetBits  = $TargetBytes * 8
$audioBudgetBits  = $AudioBitrateKbps * 1000 * $durationSeconds
$videoBudgetBits  = $totalBudgetBits - $audioBudgetBits
$videoBitrateKbps = [math]::Max(0, [math]::Floor($videoBudgetBits / $durationSeconds / 1000))
$audioOnly        = $videoBitrateKbps -lt $MinVideoBitrateKbps

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($in)
$dir      = [System.IO.Path]::GetDirectoryName($in)
if ($audioOnly) {
  $out = Join-Path $dir "$baseName-compressed.m4a"
  Write-Section "Audio-only mode ($durationHuman is too long to fit watchable video under 50 MB)"
  Write-Host "Target: $AudioBitrateKbps kbps AAC mono"
  $args = @(
    "-y", "-i", $in,
    "-vn",
    "-c:a", "aac", "-b:a", "$($AudioBitrateKbps)k", "-ac", "1",
    "-movflags", "+faststart",
    $out
  )
} else {
  $out = Join-Path $dir "$baseName-compressed.mp4"
  Write-Section "Video mode"
  Write-Host "Target: $videoBitrateKbps kbps video + $AudioBitrateKbps kbps audio, max width ${VideoMaxWidth}px"
  $args = @(
    "-y", "-i", $in,
    "-c:v", "libx264", "-preset", "ultrafast",
    "-b:v", "$($videoBitrateKbps)k",
    "-maxrate", "$($videoBitrateKbps)k",
    "-bufsize", "$($videoBitrateKbps * 2)k",
    "-vf", "scale='min($VideoMaxWidth,iw)':'-2'",
    "-c:a", "aac", "-b:a", "$($AudioBitrateKbps)k", "-ac", "1",
    "-movflags", "+faststart",
    $out
  )
}

Write-Section "Running ffmpeg"
& ffmpeg @args
if ($LASTEXITCODE -ne 0) { Fail "ffmpeg exited with code $LASTEXITCODE" }

$outSize   = (Get-Item $out).Length
$outSizeMB = [math]::Round($outSize / 1024 / 1024, 2)

Write-Section "Done"
Write-Host "Output: $out"
Write-Host "Size:   $outSizeMB MB"

if ($outSize -gt $UploadCapBytes) {
  Write-Host ""
  Write-Host "WARNING: output is above the 50 MB upload cap." -ForegroundColor Yellow
  Write-Host "Try a shorter clip or pre-trim the video."
} else {
  Write-Host ""
  Write-Host "Fits under the 50 MB cap. Drop this file into the uploader at" -ForegroundColor Green
  Write-Host "  https://video-analyzer-tra.netlify.app" -ForegroundColor Green
}

if (-not $args[0].StartsWith("-")) { Read-Host "Press Enter to exit" }
