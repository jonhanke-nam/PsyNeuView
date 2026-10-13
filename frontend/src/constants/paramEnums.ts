/**
 * Registry of enumerated-parameter dropdown choices for the inspector.
 *
 * Keyed by `(ownerType, paramName)`. When the inspector renders a parameter
 * row whose `(ownerType, paramName)` has an entry here, it renders a
 * dropdown of these keyword choices instead of a free-text input — see
 * issue #217 for the rationale (the function-class dropdown shipped in
 * #197 already covered the `function=` slot; this extends the pattern to
 * any param whose valid values are a fixed set).
 *
 * Each entry is an array of `{ label, value }`. `value` is committed
 * verbatim through `update-param` as a Python expression. We default to
 * **quoted string literals** (e.g. `'IdentityMatrix'`) so the resulting
 * source works regardless of whether the user imported `psyneulink as pnl`
 * or used `from psyneulink import *` — PsyNeuLink accepts both the
 * keyword constants and their equivalent string values interchangeably.
 *
 * Source-form upgrades (rendering as `pnl.IDENTITY_MATRIX` instead of
 * `'IdentityMatrix'` when the import style permits) are out of scope for
 * the first build and live in the #217 follow-up discussion.
 */

export interface EnumChoice {
  /** Shown in the dropdown */
  label: string;
  /** Python expression committed via update-param */
  value: string;
}

export interface EnumChoiceSet {
  choices: EnumChoice[];
  /** Optional hover tooltip for the dropdown widget */
  help?: string;
}

export const PARAM_ENUMS: Record<string, Record<string, EnumChoiceSet>> = {
  MappingProjection: {
    matrix: {
      help:
        "Common matrix keywords. PsyNeuLink accepts both the keyword " +
        "constants (pnl.IDENTITY_MATRIX) and their string equivalents " +
        "('IdentityMatrix'); the dropdown commits the string form so the " +
        "result works regardless of import style.",
      choices: [
        { label: "IDENTITY_MATRIX", value: "'IdentityMatrix'" },
        { label: "FULL_CONNECTIVITY_MATRIX", value: "'FullConnectivityMatrix'" },
        { label: "AUTO_ASSIGN_MATRIX", value: "'AutoAssignMatrix'" },
        { label: "RANDOM_CONNECTIVITY_MATRIX", value: "'RandomConnectivityMatrix'" },
        { label: "HOLLOW_MATRIX", value: "'HollowMatrix'" },
        { label: "INVERSE_HOLLOW_MATRIX", value: "'InverseHollowMatrix'" },
      ],
    },
  },
};

/**
 * Look up the enum-choice set (if any) for a given owner type / parameter
 * combination. Returns `undefined` when no dropdown should be shown.
 */
export function getEnumChoices(
  ownerType: string | undefined,
  paramName: string,
): EnumChoiceSet | undefined {
  if (!ownerType) return undefined;
  return PARAM_ENUMS[ownerType]?.[paramName];
}

/**
 * Match the current (introspected) parameter value against the registered
 * choices. Returns the matching `value` string when the current value is one
 * of the keyword choices, or undefined when it isn't (custom literal etc.).
 *
 * The introspected runtime value can arrive in several forms:
 *  - plain string ("IdentityMatrix")
 *  - quoted Python literal ("'IdentityMatrix'")
 *  - numpy-array-derived list ([[1,0],[0,1]]) — never matches a keyword
 */
export function matchEnumChoice(
  current: unknown,
  set: EnumChoiceSet,
): string | undefined {
  if (current == null) return undefined;
  const currentStr =
    typeof current === "string" ? current
    : typeof current === "object" ? JSON.stringify(current)
    : String(current);

  // Strip surrounding quotes for the comparison so "'IdentityMatrix'" and
  // "IdentityMatrix" both match the IdentityMatrix choice.
  const unquoted = currentStr.replace(/^['"]|['"]$/g, "");

  for (const c of set.choices) {
    const choiceUnquoted = c.value.replace(/^['"]|['"]$/g, "");
    if (unquoted === choiceUnquoted) return c.value;
  }
  return undefined;
}
