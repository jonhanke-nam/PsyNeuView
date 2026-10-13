/**
 * Default variable-name generation for newly-created components.
 *
 * Pattern from #181: `New_<ComponentType>_<n>` where `n` is the smallest
 * positive integer that produces a name not already in use. Names
 * generated this way are valid Python identifiers and can be passed
 * directly to the backend without further sanitization.
 *
 * The user is expected to rename via the inspector after creation;
 * this only provides a sensible default so creation doesn't block on
 * a synchronous prompt.
 */

export function generateDefaultVarName(
  componentType: string,
  existingNames: Iterable<string>,
): string {
  const taken = new Set(existingNames);
  let n = 1;
  while (taken.has(`New_${componentType}_${n}`)) {
    n += 1;
  }
  return `New_${componentType}_${n}`;
}
