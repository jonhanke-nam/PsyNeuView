import { describe, expect, it } from "vitest";
import { AUTO_PLAY_TOOLTIP, autoPlayButtonLabel } from "./traceAutoPlay";

describe("the trace bar's auto-play button (#338)", () => {
  it("reads Auto-play, then Pause while playing, then Auto-play again", () => {
    let playing = false;
    expect(autoPlayButtonLabel(playing)).toBe("▶ Auto-play");
    playing = !playing;
    expect(autoPlayButtonLabel(playing)).toBe("⏸ Pause");
    playing = !playing;
    expect(autoPlayButtonLabel(playing)).toBe("▶ Auto-play");
  });

  it("says in words, not only a symbol, and explains itself", () => {
    expect(autoPlayButtonLabel(false)).not.toContain("⏵⏵");
    expect(AUTO_PLAY_TOOLTIP).toBe("Step through the run automatically. Choose the speed beside it.");
  });
});
