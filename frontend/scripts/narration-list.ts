/**
 * Prints, as JSON, every clip the recorded voices need (#159): its voice, its
 * file under public/narration/, and the words it says. Read by
 * scripts/render-narration.py; run with `npm run narration:list`.
 */
import { narratedCaptions } from "../src/utils/narratedCaptions";
import { RECORDED_VOICES, clipFile, recordedWords } from "../src/utils/recordedNarration";

const clips = RECORDED_VOICES.flatMap((voice) =>
  narratedCaptions().map((caption) => ({
    voice: voice.id,
    kokoro: voice.kokoro,
    file: `${voice.id}/${clipFile(caption)}`,
    words: recordedWords(caption),
  })),
);
process.stdout.write(JSON.stringify(clips, null, 1) + "\n");
