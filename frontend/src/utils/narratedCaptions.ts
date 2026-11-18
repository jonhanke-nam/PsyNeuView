/**
 * Every line narration can read (#159): each walkthrough step's caption (its
 * own line, or its instruction, as the walkthrough bar reads it) and Settings'
 * sample. The recorded voices have a clip for each; `npm run narration:list`
 * prints them for the renderer.
 */

import { WALKTHROUGHS } from "./tourStep";
import { SAMPLE_CAPTION } from "./narration";

export function narratedCaptions(): string[] {
  const lines = new Set<string>([SAMPLE_CAPTION.trim()]);
  for (const w of Object.values(WALKTHROUGHS)) {
    for (const step of w.steps) {
      const line = (step.say ?? step.instruct).trim();
      if (line) lines.add(line);
    }
  }
  return [...lines];
}
