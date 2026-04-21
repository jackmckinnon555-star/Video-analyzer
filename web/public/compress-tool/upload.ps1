# TRA Video Analyzer — desktop uploader (Windows PowerShell)
#
# One script: compresses your video with native ffmpeg, uploads it straight to
# the server, prints the results URL. No browser compression step, no drag-drop
# between tabs.
#
# Usage:
#   .\upload.ps1 "C:\path\to\video.mp4"
# Or drag-drop a video file onto this script in Explorer (right-click → Run
# with PowerShell).
#
# First run will prompt for the site password once and cache it at
# %APPDATA%\video-analyzer\config.json (you can delete that file anytime).

[CmdletBinding()]
param(
  [Parameter(Position = 0, Mandatory = $false)]
  [string]$InputFile
)

$ErrorActionPreference = "Stop"

# ---- Constants (must match web/src/lib/compressStreaming.ts) ----
$SiteBase           = "https://video-analyzer-tra.netlify.app"
$TargetBytes        = 47 * 1024 * 1024
$UploadCapBytes     = 50 * 1024 * 1024
$AudioBitrateKbps   = 32
$MinVideoBitrateKbps = 100
$VideoMaxWidth      = 640

$ConfigDir  = Join-Path $env:APPDATA "video-analyzer"
$ConfigPath = Join-Path $ConfigDir "config.json"

function Write-Section($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}
function Write-Ok($msg)  { Write-Host "  $msg" -ForegroundColor Green }
function Write-Warn($msg){ Write-Host "  $msg" -ForegroundColor Yellow }
function Fail($msg) {
  Write-Host ""
  Write-Host "ERROR: $msg" -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

# ---- Load or prompt for config ----
function Get-Config {
  $cfg = $null
  # Env var takes precedence
  if ($env:VIDEO_ANALYZER_PASSWORD) {
    $cfg = @{ password = $env:VIDEO_ANALYZER_PASSWORD }
  }
  elseif (Test-Path $ConfigPath) {
    try {
      $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json -AsHashtable
    } catch {
      Write-Warn "Couldn't read saved config — will re-prompt"
      $cfg = $null
    }
  }
  if (-not $cfg -or -not $cfg.password) {
    Write-Host ""
    Write-Host "First run — enter the site password" -ForegroundColor Cyan
    Write-Host "(ask whoever set up the tool; it's the same one the website uses)"
    $secure = Read-Host -AsSecureString "Password"
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $pw   = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    if (-not $pw) { Fail "No password entered" }
    $cfg = @{ password = $pw }
    # Persist
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    $cfg | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding utf8
    Write-Ok "Saved to $ConfigPath"
  }
  return $cfg
}

# ---- Resolve input ----
if (-not $InputFile) {
  Write-Host "TRA Video Analyzer — desktop uploader" -ForegroundColor Cyan
  Write-Host ""
  $InputFile = Read-Host "Drag your video here, then press Enter"
  $InputFile = $InputFile.Trim('"').Trim()
}
if (-not (Test-Path $InputFile)) { Fail "File not found: $InputFile" }
$in = (Get-Item $InputFile).FullName
$inSizeMB = [math]::Round((Get-Item $in).Length / 1MB, 1)

# ---- ffmpeg check ----
if (-not (Get-Command ffmpeg  -ErrorAction SilentlyContinue)) {
  Fail "ffmpeg not found in PATH.  Install: ``winget install Gyan.FFmpeg``  (restart your terminal after)"
}
if (-not (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
  Fail "ffprobe not found (bundled with ffmpeg)"
}

Write-Section "Setting up"
$cfg = Get-Config

Write-Section "Probing duration"
$durationSeconds = [double](& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $in)
if (-not $durationSeconds -or $durationSeconds -le 0) { Fail "Could not read video duration" }
$durationHuman = "{0}m {1}s" -f ([int]($durationSeconds / 60)), ([int]($durationSeconds % 60))
Write-Ok "File: $(Split-Path $in -Leaf) (${inSizeMB} MB, $durationHuman)"

# ---- Bitrate budget ----
$totalBudgetBits  = $TargetBytes * 8
$audioBudgetBits  = $AudioBitrateKbps * 1000 * $durationSeconds
$videoBudgetBits  = $totalBudgetBits - $audioBudgetBits
$videoBitrateKbps = [math]::Max(0, [math]::Floor($videoBudgetBits / $durationSeconds / 1000))
$audioOnly        = $videoBitrateKbps -lt $MinVideoBitrateKbps

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($in)
$tmpOut   = Join-Path $env:TEMP ("video-analyzer-$(Get-Random)-" + ($(if ($audioOnly) { "audio.m4a" } else { "video.mp4" })))

if ($audioOnly) {
  Write-Section "Compressing audio-only ($durationHuman is too long for watchable video under 50 MB)"
  Write-Ok "Target: $AudioBitrateKbps kbps mono AAC"
  $args = @(
    "-y", "-i", $in, "-vn",
    "-c:a", "aac", "-b:a", "$($AudioBitrateKbps)k", "-ac", "1",
    "-movflags", "+faststart",
    $tmpOut
  )
  $uploadName = "$baseName-compressed.m4a"
  $uploadType = "audio/mp4"
} else {
  Write-Section "Compressing video"
  Write-Ok "Target: $videoBitrateKbps kbps video + $AudioBitrateKbps kbps audio, ${VideoMaxWidth}px wide"
  $args = @(
    "-y", "-i", $in,
    "-c:v", "libx264", "-preset", "ultrafast",
    "-b:v", "$($videoBitrateKbps)k",
    "-maxrate", "$($videoBitrateKbps)k",
    "-bufsize", "$($videoBitrateKbps * 2)k",
    "-vf", "scale='min($VideoMaxWidth,iw)':'-2'",
    "-c:a", "aac", "-b:a", "$($AudioBitrateKbps)k", "-ac", "1",
    "-movflags", "+faststart",
    $tmpOut
  )
  $uploadName = "$baseName-compressed.mp4"
  $uploadType = "video/mp4"
}

& ffmpeg @args
if ($LASTEXITCODE -ne 0) { Fail "ffmpeg exited $LASTEXITCODE" }

$outSize   = (Get-Item $tmpOut).Length
$outSizeMB = [math]::Round($outSize / 1MB, 2)
Write-Ok "Compressed to $outSizeMB MB"

if ($outSize -gt $UploadCapBytes) {
  Remove-Item $tmpOut -ErrorAction SilentlyContinue
  Fail "Output is ${outSizeMB} MB — above the 50 MB upload cap. Try a shorter clip."
}

# ---- Presign upload URL ----
Write-Section "Reserving upload slot"
try {
  $presign = Invoke-RestMethod -Method POST "$SiteBase/api/presign-upload" `
    -Headers @{ "X-Site-Password" = $cfg.password } `
    -ContentType "application/json" `
    -Body (@{
      filename    = $uploadName
      contentType = $uploadType
      sizeBytes   = $outSize
    } | ConvertTo-Json)
} catch {
  $status = $null
  if ($_.Exception.Response) { $status = $_.Exception.Response.StatusCode.value__ }
  Remove-Item $tmpOut -ErrorAction SilentlyContinue
  if ($status -eq 401) {
    Remove-Item $ConfigPath -ErrorAction SilentlyContinue
    Fail "Invalid site password. Saved config cleared — run the script again and re-enter."
  }
  Fail "Presign failed: $($_.Exception.Message)"
}
Write-Ok "Got signed URL (video id: $($presign.videoId))"

# ---- Upload ----
Write-Section "Uploading ($outSizeMB MB)"
try {
  # Invoke-WebRequest handles the streaming upload cleanly with -InFile.
  Invoke-WebRequest -Method PUT $presign.signedUrl `
    -ContentType $uploadType `
    -InFile $tmpOut `
    -UseBasicParsing | Out-Null
} catch {
  Remove-Item $tmpOut -ErrorAction SilentlyContinue
  Fail "Upload failed: $($_.Exception.Message)"
}
Write-Ok "Uploaded"

# ---- Finalize ----
Write-Section "Queuing for processing"
try {
  Invoke-RestMethod -Method POST "$SiteBase/api/finalize-upload" `
    -Headers @{ "X-Site-Password" = $cfg.password } `
    -ContentType "application/json" `
    -Body (@{ videoId = $presign.videoId } | ConvertTo-Json) | Out-Null
} catch {
  Remove-Item $tmpOut -ErrorAction SilentlyContinue
  Fail "Finalize failed: $($_.Exception.Message) — video is in storage but processing didn't start. You can trigger it from the dashboard."
}

Remove-Item $tmpOut -ErrorAction SilentlyContinue

$resultUrl = "$SiteBase/video/$($presign.videoId)"
Write-Section "Done"
Write-Host ""
Write-Host "Your video is processing at:" -ForegroundColor Cyan
Write-Host "  $resultUrl" -ForegroundColor Green
Write-Host ""
Write-Host "Opening in your default browser…"
Start-Process $resultUrl

# Hold terminal when script was double-clicked (no input args)
if (-not $args[0].StartsWith("-")) { Read-Host "Press Enter to exit" }
