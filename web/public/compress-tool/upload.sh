#!/usr/bin/env bash
# TRA Video Analyzer — desktop uploader (macOS / Linux / Git Bash)
#
# One script: compresses your video with native ffmpeg, uploads it straight
# to the server, prints the results URL. No browser compression step.
#
# Usage:   ./upload.sh path/to/video.mp4
#
# First run prompts for the site password once and caches it at
# ~/.config/video-analyzer/config.json (chmod 600).

set -euo pipefail

SITE_BASE="https://video-analyzer-tra.netlify.app"
TARGET_BYTES=$((47 * 1024 * 1024))
UPLOAD_CAP_BYTES=$((50 * 1024 * 1024))
AUDIO_BITRATE_KBPS=32
MIN_VIDEO_BITRATE_KBPS=100
VIDEO_MAX_WIDTH=640

CFG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/video-analyzer"
CFG_FILE="$CFG_DIR/config.json"

cyan()  { printf '\033[36m==> %s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m%s\033[0m\n' "$*"; }
warn()  { printf '  \033[33m%s\033[0m\n' "$*"; }
fail()  { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "$1 not found — install ffmpeg first (macOS: brew install ffmpeg · Linux: sudo apt install ffmpeg)"; }
need ffmpeg
need ffprobe
need curl

# Input resolution
INPUT="${1:-}"
if [[ -z "$INPUT" ]]; then
  echo "TRA Video Analyzer — desktop uploader"
  echo ""
  read -rp "Drag your video here, then press Enter: " INPUT
  INPUT="${INPUT%\"}"; INPUT="${INPUT#\"}"
fi
[[ -f "$INPUT" ]] || fail "File not found: $INPUT"

# Password from env > config > prompt
get_password() {
  if [[ -n "${VIDEO_ANALYZER_PASSWORD:-}" ]]; then
    PASSWORD="$VIDEO_ANALYZER_PASSWORD"
    return
  fi
  if [[ -f "$CFG_FILE" ]]; then
    PASSWORD=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$CFG_FILE','utf8'));process.stdout.write(c.password||'')}catch{}" 2>/dev/null || true)
    if [[ -n "$PASSWORD" ]]; then return; fi
  fi
  echo ""
  echo "First run — enter the site password"
  echo "(ask whoever set up the tool; same one the website uses)"
  read -rsp "Password: " PASSWORD
  echo ""
  [[ -n "$PASSWORD" ]] || fail "No password entered"
  mkdir -p "$CFG_DIR"
  chmod 700 "$CFG_DIR"
  node -e "require('fs').writeFileSync('$CFG_FILE', JSON.stringify({password:process.argv[1]}))" "$PASSWORD"
  chmod 600 "$CFG_FILE"
  ok "Saved to $CFG_FILE"
}

cyan "Setting up"
get_password

cyan "Probing duration"
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT")
[[ -n "$DURATION" ]] || fail "Could not read duration"
DUR_INT=$(printf "%.0f" "$DURATION")
DUR_MIN=$((DUR_INT / 60))
DUR_SEC=$((DUR_INT % 60))
IN_MB=$(echo "scale=1; $(wc -c <"$INPUT") / 1048576" | bc -l)
ok "File: $(basename "$INPUT") (${IN_MB} MB, ${DUR_MIN}m ${DUR_SEC}s)"

# Bitrate math (bc for float)
TOTAL_BUDGET_BITS=$((TARGET_BYTES * 8))
AUDIO_BUDGET_BITS=$(echo "$AUDIO_BITRATE_KBPS * 1000 * $DURATION" | bc -l)
VIDEO_BUDGET_BITS=$(echo "$TOTAL_BUDGET_BITS - $AUDIO_BUDGET_BITS" | bc -l)
VIDEO_KBPS=$(echo "scale=0; $VIDEO_BUDGET_BITS / $DURATION / 1000" | bc -l)
(( VIDEO_KBPS < 0 )) && VIDEO_KBPS=0
AUDIO_ONLY=0
if (( VIDEO_KBPS < MIN_VIDEO_BITRATE_KBPS )); then AUDIO_ONLY=1; fi

BASE=$(basename "$INPUT")
BASE="${BASE%.*}"
TMP=$(mktemp)
if [[ $AUDIO_ONLY -eq 1 ]]; then
  TMP_OUT="${TMP}.m4a"
  UPLOAD_NAME="$BASE-compressed.m4a"
  UPLOAD_TYPE="audio/mp4"
  cyan "Compressing audio-only (${DUR_MIN}m is too long for watchable video under 50 MB)"
  ok "Target: $AUDIO_BITRATE_KBPS kbps mono AAC"
  ffmpeg -y -i "$INPUT" \
    -vn -c:a aac -b:a "${AUDIO_BITRATE_KBPS}k" -ac 1 \
    -movflags +faststart "$TMP_OUT"
else
  TMP_OUT="${TMP}.mp4"
  UPLOAD_NAME="$BASE-compressed.mp4"
  UPLOAD_TYPE="video/mp4"
  cyan "Compressing video"
  ok "Target: ${VIDEO_KBPS} kbps video + ${AUDIO_BITRATE_KBPS} kbps audio, ${VIDEO_MAX_WIDTH}px wide"
  BUFSIZE=$((VIDEO_KBPS * 2))
  ffmpeg -y -i "$INPUT" \
    -c:v libx264 -preset ultrafast \
    -b:v "${VIDEO_KBPS}k" -maxrate "${VIDEO_KBPS}k" -bufsize "${BUFSIZE}k" \
    -vf "scale='min(${VIDEO_MAX_WIDTH},iw)':'-2'" \
    -c:a aac -b:a "${AUDIO_BITRATE_KBPS}k" -ac 1 \
    -movflags +faststart \
    "$TMP_OUT"
fi
rm -f "$TMP"

OUT_SIZE=$(wc -c <"$TMP_OUT" | tr -d ' ')
OUT_MB=$(echo "scale=2; $OUT_SIZE / 1048576" | bc -l)
ok "Compressed to ${OUT_MB} MB"

if (( OUT_SIZE > UPLOAD_CAP_BYTES )); then
  rm -f "$TMP_OUT"
  fail "Output is ${OUT_MB} MB — above the 50 MB upload cap. Try a shorter clip."
fi

cyan "Reserving upload slot"
PRESIGN=$(curl -sS -X POST "$SITE_BASE/api/presign-upload" \
  -H "X-Site-Password: $PASSWORD" \
  -H "Content-Type: application/json" \
  -d "$(node -e 'const n=process.argv[1],t=process.argv[2],s=process.argv[3];process.stdout.write(JSON.stringify({filename:n,contentType:t,sizeBytes:Number(s)}))' "$UPLOAD_NAME" "$UPLOAD_TYPE" "$OUT_SIZE")") || {
  rm -f "$TMP_OUT"; fail "Presign request failed"
}
if echo "$PRESIGN" | grep -q 'Invalid site password'; then
  rm -f "$CFG_FILE" "$TMP_OUT"
  fail "Invalid site password. Saved config cleared — re-run to re-enter."
fi

VIDEO_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).videoId||'')" "$PRESIGN")
SIGNED_URL=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).signedUrl||'')" "$PRESIGN")
[[ -n "$VIDEO_ID" && -n "$SIGNED_URL" ]] || { rm -f "$TMP_OUT"; fail "Unexpected presign response: $(echo "$PRESIGN" | head -c 200)"; }
ok "Got signed URL (video id: $VIDEO_ID)"

cyan "Uploading (${OUT_MB} MB)"
curl -sS -X PUT "$SIGNED_URL" \
  -H "Content-Type: $UPLOAD_TYPE" \
  --data-binary "@$TMP_OUT" >/dev/null || {
    rm -f "$TMP_OUT"; fail "Upload failed"
  }
ok "Uploaded"

cyan "Queuing for processing"
FIN=$(curl -sS -X POST "$SITE_BASE/api/finalize-upload" \
  -H "X-Site-Password: $PASSWORD" \
  -H "Content-Type: application/json" \
  -d "$(node -e 'process.stdout.write(JSON.stringify({videoId:process.argv[1]}))' "$VIDEO_ID")")
if echo "$FIN" | grep -q '"error"'; then
  rm -f "$TMP_OUT"
  warn "Finalize reported an error (video is in storage but processing didn't start). You can trigger it from the dashboard."
  echo "$FIN"
  exit 1
fi

rm -f "$TMP_OUT"

RESULT_URL="$SITE_BASE/video/$VIDEO_ID"
cyan "Done"
echo ""
printf '\033[32mYour video is processing at:\033[0m\n'
echo "  $RESULT_URL"
echo ""
# Try to open in a browser
if command -v open >/dev/null 2>&1; then open "$RESULT_URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$RESULT_URL"
fi
