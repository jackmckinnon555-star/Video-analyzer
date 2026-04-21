TRA Video Analyzer — Desktop Uploader
======================================

What this is
------------
A small script that compresses your video locally with ffmpeg, uploads it
to the Video Analyzer server, and opens the results page in your browser.
One script. Handles any file size. No in-browser compression dance.

Why
---
The in-browser compressor tops out around 2 GB and is fragile on real-world
inputs. This script sidesteps every one of those problems by running native
ffmpeg (2-5× realtime) and uploading the result through the same API the
web page uses.

Prereq
------
  Install ffmpeg, once:
    Windows:  winget install Gyan.FFmpeg
    macOS:    brew install ffmpeg
    Linux:    sudo apt install ffmpeg

  Verify: run `ffmpeg -version` in a terminal. You should see a version.

Usage — Windows
---------------
  Download upload.ps1.

  PowerShell (common):
    .\upload.ps1 "C:\path\to\video.mp4"

  Drag-drop (right-click → Run with PowerShell):
    Drop any video onto upload.ps1 in Explorer.

  If PowerShell blocks unsigned scripts:
    powershell -ExecutionPolicy Bypass -File .\upload.ps1 "video.mp4"

Usage — macOS / Linux / Git Bash
--------------------------------
  chmod +x upload.sh
  ./upload.sh path/to/video.mp4

First run
---------
  You'll be prompted for the site password once. It's saved to:
    Windows:  %APPDATA%\video-analyzer\config.json
    Unix:     ~/.config/video-analyzer/config.json  (chmod 600)

  Subsequent runs read it silently. To clear, delete that file.
  To override, set VIDEO_ANALYZER_PASSWORD in your environment.

What happens
------------
  1. ffmpeg compresses your video to ~47 MB (fits the 50 MB upload cap).
     Long videos auto-fall-back to audio-only.
  2. Script calls the server, gets a signed upload URL.
  3. Compressed file streams straight into storage.
  4. Server queues the analysis job.
  5. Script prints (and opens) the results URL. Server-side processing
     continues for another 2-5 minutes; that page updates live.

Runtime
-------
  Native ffmpeg on modern hardware: ~2-5× realtime for ultrafast H.264.
    1-hour talk ~ 15-30 sec to compress
    3-hour talk ~ 45-90 sec to compress
  Upload: ~10-30 sec for a 47 MB file over most connections.

Also on this page
-----------------
  compress.ps1 / compress.sh — compress-only scripts. Produce the same
  file without uploading it (useful if you want to hand the compressed
  file to someone else, or drop it into the web uploader manually).

Troubleshooting
---------------
  "ffmpeg not found": installer didn't add it to PATH. Restart terminal;
    on Windows, log out and back in if needed.

  "Invalid site password": the script clears the saved password on a 401
    response. Run again and re-enter.

  SmartScreen blocked the .ps1: right-click file → Properties →
    "Unblock" at bottom → OK.

  Output still >50 MB (very long source): split first with
    ffmpeg -i input.mp4 -t 3600 -c copy part1.mp4
    Then upload each part separately.

  Upload failed mid-way: just re-run the script. It makes a new
    upload slot each time.
