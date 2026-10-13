/**
 * Path resolver for canonical E2E fixture models (#148).
 *
 * Specs that need a deterministic model use `fixturePath('single_transfer')`
 * to get the absolute path, then pass it to whatever load surface the
 * test exercises (file picker, /api/load-model body, etc.).
 *
 * Keeping the registry typed means a fixture rename is a TS compile
 * error, not a 404 at runtime.
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

export type FixtureName =
  | "single_transfer"
  | "two_mech_projection"
  | "two_input_nodes"
  | "with_controller"
  | "recurrent_self"
  | "nested_minimal"
  | "deep_nested";

export function fixturePath(name: FixtureName): string {
  return path.join(FIXTURES_DIR, `${name}.py`);
}

export const FIXTURES_ROOT = FIXTURES_DIR;
