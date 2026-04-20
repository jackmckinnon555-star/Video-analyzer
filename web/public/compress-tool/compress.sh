#!/usr/bin/env bash
# TRA Video Analyzer — local pre-compression (macOS / Linux / Git Bash)
# Usage: ./compress.sh path/to/video.mp4
#
# Produces <50 MB output ready for https://video-analyzer-tra.netlify.app
# Identical settings to the in-browser compressor.

set -euo pipefail

# ---- Constants (must match web/src/lib/compress.ts) ----
TARGET_BYTES=$((47 * 1024 * 1024))
UPLOAD_CAP_BYTES=$((50 * 1024 * 1024))
AUDIO_BITRATE_KBPS=32
MIN_VIDEO_BITRATE_KBPS=100
VIDEO_MAX_WIDTH=640

cyan()  { printf '\033[36m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }

fail() { red "ERROR: $*"; exit 1; }

command -v ffmpeg  >/dev/null 2>&1 || fail "ffmpeg not found — install via https://ffmpeg.org/download.html (macOS: 'brew install ffmpeg')"
command -v ffprobe >/dev/null 2>&1 || fail "ffprobe not found (comes with ffmpeg)"

INPUT="${1:-}"
if [[ -z "$INPUT" ]]; then
  read -rp "Drag your video file here, then press Enter: " INPUT
  # strip surrounding quotes if drag-drop added them
  INPUT="${INPUT%\"}"; INPUT="${INPUT#\"}"
fi
[[ -f "$INPUT" ]] || fail "File not found: $INPUT"

cyan "==> Probing duration"
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT")
[[ -n "$DURATION" ]] || fail "Could not read duration"
DURATION_INT=$(printf "%.0f" "$DURATION")
DUR_MIN=$((DURATION_INT / 60))
DUR_SEC=$((DURATION_INT % 60))
echo "Duration: ${DUR_MIN}m ${DUR_SEC}s"

# ---- Bitrate budget (use bc for float math) ----
TOTAL_BUDGET_BITS=$((TARGET_BYTES * 8))
AUDIO_BUDGET_BITS=$(echo "$AUDIO_BITRATE_KBPS * 1000 * $DURATION" | bc -l)
VIDEO_BUDGET_BITS=$(echo "$TOTAL_BUDGET_BITS - $AUDIO_BUDGET_BITS" | bc -l)
VIDEO_KBPS=$(echo "scale=0; $VIDEO_BUDGET_BITS / $DURATION / 1000" | bc -l)
if (( VIDEO_KBPS < 0 )); then VIDEO_KBPS=0; fi

BASENAME=$(basename "$INPUT")
BASE="${BASENAME%.*}"
DIR=$(dirname "$INPUT")

if (( VIDEO_KBPS < MIN_VIDEO_BITRATE_KBPS )); then
  OUT="$DIR/${BASE}-compressed.m4a"
  cyan "==> Audio-only mode (${DUR_MIN}m is too long to fit watchable video under 50 MB)"
  echo "Target: ${AUDIO_BITRATE_KBPS} kbps AAC mono"
  ffmpeg -y -i "$INPUT" \
    -vn \
    -c:a aac -b:a "${AUDIO_BITRATE_KBPS}k" -ac 1 \
    -movflags +faststart \
    "$OUT"
else
  OUT="$DIR/${BASE}-compressed.mp4"
  cyan "==> Video mode"
  echo "Target: ${VIDEO_KBPS} kbps video + ${AUDIO_BITRATE_KBPS} kbps audio, max width ${VIDEO_MAX_WIDTH}px"
  BUFSIZE=$((VIDEO_KBPS * 2))
  ffmpeg -y -i "$INPUT" \
    -c:v libx264 -preset ultrafast \
    -b:v "${VIDEO_KBPS}k" -maxrate "${VIDEO_KBPS}k" -bufsize "${BUFSIZE}k" \
    -vf "scale='min(${VIDEO_MAX_WIDTH},iw)':'-2'" \
    -c:a aac -b:a "${AUDIO_BITRATE_KBPS}k" -ac 1 \
    -movflags +faststart \
    "$OUT"
fi

OUT_SIZE=$(wc -c <"$OUT" | tr -d ' ')
OUT_MB=$(echo "scale=2; $OUT_SIZE / 1048576" | bc -l)
cyan "==> Done"
echo "Output: $OUT"
echo "Size:   ${OUT_MB} MB"
echo ""

if (( OUT_SIZE > UPLOAD_CAP_BYTES )); then
  red "WARNING: output is above the 50 MB upload cap. Try a shorter clip."
else
  green "Fits under the 50 MB cap. Drop this file into the uploader at"
  green "  https://video-analyzer-tra.netlify.app"
fi
