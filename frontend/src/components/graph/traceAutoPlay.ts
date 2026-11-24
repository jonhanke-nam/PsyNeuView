/**
 * What the trace bar's auto-play button says (#338). It used to show only
 * "⏵⏵", which read like fast-forward or skip; it now says what it does, and
 * says Pause while it is playing.
 */
export const AUTO_PLAY_TOOLTIP =
  "Step through the run automatically. Choose the speed beside it.";

export function autoPlayButtonLabel(isPlaying: boolean): string {
  return isPlaying ? "⏸ Pause" : "▶ Auto-play";
}
