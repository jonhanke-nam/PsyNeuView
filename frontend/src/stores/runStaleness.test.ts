import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useModelStore } from "./modelStore";
import { useRunResults } from "./runResultsStore";
import { CHECK_DELAY_MS, isStale, watchRunStaleness } from "./runStaleness";
import { cachedSourceHash, hashSource } from "@/utils/sourceHash";

const RAN = "gain = 1.0\n";
const EDITED = "gain = 2.0\n";

function runOn(source: string) {
  useRunResults.getState().setResults({
    results: [],
    logs: {},
    numTrials: 0,
    sourceHash: cachedSourceHash(source),
    compositionName: "stroop",
  });
}

describe("run results staleness (#337)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    watchRunStaleness();
    useModelStore.getState().setSource(RAN);
    useRunResults.getState().clearResults();
    useModelStore.setState({ activeComposition: "stroop" });
  });
  afterEach(() => vi.useRealTimers());

  it("hashes the same text the same, different text differently", () => {
    expect(hashSource(RAN)).toBe(hashSource(String(RAN)));
    expect(hashSource(RAN)).not.toBe(hashSource(EDITED));
  });

  it("no results, never stale", () => {
    expect(isStale(EDITED)).toBe(false);
  });

  it("an edit makes results stale and clears the trace; undo makes them current", () => {
    runOn(RAN);
    useModelStore.setState({ executionTrace: [["a"]] as never });
    useModelStore.getState().setSource(EDITED);
    // Not while typing: only once edits pause.
    expect(useRunResults.getState().stale).toBe(false);
    vi.advanceTimersByTime(CHECK_DELAY_MS);
    expect(useRunResults.getState().stale).toBe(true);
    expect(useModelStore.getState().executionTrace).toHaveLength(0);

    useModelStore.getState().setSource(RAN);
    vi.advanceTimersByTime(CHECK_DELAY_MS);
    expect(useRunResults.getState().stale).toBe(false);
  });

  it("the same text set again (a fold toggle's reload) is not stale", () => {
    runOn(RAN);
    useModelStore.getState().setSource(`${RAN}`.slice(0));
    vi.advanceTimersByTime(CHECK_DELAY_MS);
    expect(useRunResults.getState().stale).toBe(false);
  });

  it("new results and clearing both reset staleness", () => {
    runOn(RAN);
    useModelStore.getState().setSource(EDITED);
    vi.advanceTimersByTime(CHECK_DELAY_MS);
    expect(useRunResults.getState().stale).toBe(true);
    runOn(EDITED);
    expect(useRunResults.getState().stale).toBe(false);
    useRunResults.getState().clearResults();
    expect(useRunResults.getState().stale).toBe(false);
  });

  it("choosing another composition makes results stale; choosing back makes them current", () => {
    runOn(RAN);
    useModelStore.setState({ activeComposition: "other" });
    vi.advanceTimersByTime(CHECK_DELAY_MS);
    expect(useRunResults.getState().stale).toBe(true);
    expect(isStale(RAN, "other")).toBe(true);
    useModelStore.setState({ activeComposition: "stroop" });
    vi.advanceTimersByTime(CHECK_DELAY_MS);
    expect(useRunResults.getState().stale).toBe(false);
  });
});
