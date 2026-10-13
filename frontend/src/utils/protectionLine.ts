/**
 * The protection line, for a `.py` copy downloaded from the browser (#1346).
 *
 * The backend owns detection (`backend/app/services/protection_line.py`) and
 * strips the line from every `.py` copy it writes. A downloaded `.py` never
 * reaches the backend — the editor's text is handed straight to the browser —
 * so this mirrors the backend's rule for that one case: a copy starts
 * unprotected, whatever its original said. Same pattern, same place (the
 * leading comment block only); keep the two in step.
 */

const LINE = /^\s*#\s*psyneuview\s*:\s*protected(\s+permanently)?\s*$/i;

/** The text without the protection lines in its leading comment block. */
export function stripProtectionLine(source: string): string {
  const lines = source.split(/(?<=\n)/);
  let inHeader = true;
  return lines
    .filter((line) => {
      if (!inHeader) return true;
      const bare = line.replace(/\r?\n$/, "");
      const stripped = bare.trim();
      if (stripped && !stripped.startsWith("#")) {
        inHeader = false;
        return true;
      }
      return !LINE.test(bare);
    })
    .join("");
}
