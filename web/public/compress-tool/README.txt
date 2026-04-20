TRA Video Analyzer — Local Pre-Compression
============================================

Why this tool exists
--------------------
The in-browser compressor tops out around 2 GB because browsers have to
buffer the whole file into memory before ffmpeg can read it. Raw 1080p
video over an hour or two sails past that. Running ffmpeg locally has
no such limit — it streams the file from disk.

Output matches what the in-browser tool would produce (same bitrates,
same container), so the web uploader accepts it as-is and skips its own
compression step.

Prerequisite
------------
You need ffmpeg installed and on PATH.

  Windows:   winget install Gyan.FFmpeg
             (or: https://ffmpeg.org/download.html)
  macOS:     brew install ffmpeg
  Linux:     sudo apt install ffmpeg   (or your distro's equivalent)

Verify: open a terminal and run `ffmpeg -version`. You should see a version.

Usage — Windows (PowerShell)
----------------------------
  1. Download compress.ps1
  2. In PowerShell: .\compress.ps1 "C:\path\to\video.mp4"
     OR drag-drop a video onto the script in Explorer (right-click →
     Run with PowerShell).

  If PowerShell blocks unsigned scripts:
     powershell -ExecutionPolicy Bypass -File .\compress.ps1 "video.mp4"

Usage — macOS / Linux / Git Bash
--------------------------------
  1. Download compress.sh
  2. chmod +x compress.sh
  3. ./compress.sh path/to/video.mp4

Output
------
  Saved alongside the original:
    * video mode:      name-compressed.mp4
    * audio-only mode: name-compressed.m4a  (used for multi-hour videos
                                              where video won't fit at
                                              watchable quality)

  Size target: 47 MB (under the 50 MB upload cap with headroom).

Runtime
-------
  Native ffmpeg is ~2-5× realtime on a modern CPU. A 3-hour talk
  compresses in 30-90 seconds.

After compression
-----------------
  Drop the resulting file into the uploader at
  https://video-analyzer-tra.netlify.app — it'll accept it directly
  without re-compressing.

Troubleshooting
---------------
  * "ffmpeg not found": not installed or not on PATH. Restart terminal
    after installing.
  * Windows SmartScreen blocks the .ps1: right-click → Properties →
    "Unblock" at bottom of the dialog, then retry.
  * Output still >50 MB: the source is extraordinarily long (>10 hours)
    or extraordinarily information-dense. Split it with
    `ffmpeg -i input.mp4 -t 3600 -c copy part1.mp4` then compress each
    part separately.
