import { useEffect, type RefObject } from "react";

/**
 * YouTube-style keyboard shortcuts for the VideoResult player.
 *
 * Space        play/pause
 * ← / →        seek -5s / +5s
 * Shift+← / →  seek -30s / +30s
 * J / L        seek -10s / +10s
 * K            play/pause (alt)
 * ,  .         step frame back/forward (1/30s)
 * < / >        playback speed down/up
 * M            mute toggle
 * F            fullscreen
 */
export function useVideoKeyboard(
  playerRef: RefObject<HTMLVideoElement | null>,
  onHelp?: () => void,
): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const v = playerRef.current;
      if (!v) return;
      // Ignore while typing in inputs / textareas / contenteditable.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      let handled = true;
      switch (e.key) {
        case " ":
        case "k":
        case "K":
          v.paused ? v.play() : v.pause();
          break;
        case "ArrowLeft":
          v.currentTime = Math.max(0, v.currentTime - (e.shiftKey ? 30 : 5));
          break;
        case "ArrowRight":
          v.currentTime = Math.min(v.duration || Infinity, v.currentTime + (e.shiftKey ? 30 : 5));
          break;
        case "j":
        case "J":
          v.currentTime = Math.max(0, v.currentTime - 10);
          break;
        case "l":
        case "L":
          v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10);
          break;
        case ",":
          v.currentTime = Math.max(0, v.currentTime - 1 / 30);
          break;
        case ".":
          v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 1 / 30);
          break;
        case "<":
          v.playbackRate = Math.max(0.25, +(v.playbackRate - 0.25).toFixed(2));
          break;
        case ">":
          v.playbackRate = Math.min(4, +(v.playbackRate + 0.25).toFixed(2));
          break;
        case "m":
        case "M":
          v.muted = !v.muted;
          break;
        case "f":
        case "F":
          if (document.fullscreenElement) document.exitFullscreen();
          else v.requestFullscreen().catch(() => {});
          break;
        case "?":
          onHelp?.();
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playerRef, onHelp]);
}
