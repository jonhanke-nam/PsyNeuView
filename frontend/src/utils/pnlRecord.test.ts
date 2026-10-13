import { describe, expect, it } from "vitest";
import { describeRecord, pnlRecordMismatch, recordForLiveInstall } from "./pnlRecord";
import type { PsyNeuLinkInfo } from "./pnlSources";

const info = (over: Partial<PsyNeuLinkInfo>): PsyNeuLinkInfo => ({
  version: "0.21.0.0", source: "unknown", branch: null, repo: null, commit: null, path: null, ...over,
});

describe("the Mac app's PsyNeuLink record vs the live install (PsyNeuView-MacApp#9)", () => {
  const checkout = info({ source: "editable", path: "/Users/someone/PsyNeuLink", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink" });

  it("describes each kind of live install in the record's words", () => {
    expect(recordForLiveInstall(checkout)).toBe("local:/Users/someone/PsyNeuLink");
    expect(recordForLiveInstall(info({ source: "github", branch: "devel" }))).toBe("github:devel");
    expect(recordForLiveInstall(info({ source: "pypi" }))).toBe("pypi");
    expect(recordForLiveInstall(info({ source: "unknown" }))).toBeNull();
  });

  it("flags the reported case: record says GitHub devel, a checkout is installed", () => {
    expect(pnlRecordMismatch("github:devel", checkout)).toEqual({
      record: "github:devel",
      live: "local:/Users/someone/PsyNeuLink",
    });
  });

  it("agrees when they match, ignoring a trailing slash", () => {
    expect(pnlRecordMismatch("local:/Users/someone/PsyNeuLink/", checkout)).toBeNull();
    expect(pnlRecordMismatch("github:devel", info({ source: "github", branch: "devel" }))).toBeNull();
  });

  it("never claims a mismatch it can't show", () => {
    expect(pnlRecordMismatch(undefined, checkout)).toBeNull();
    expect(pnlRecordMismatch("github:devel", info({ source: "unknown" }))).toBeNull();
    expect(pnlRecordMismatch("github:devel", null)).toBeNull();
  });

  it("says each record in plain words", () => {
    expect(describeRecord("github:devel")).toBe("GitHub (devel)");
    expect(describeRecord("pypi")).toBe("an official release (PyPI)");
    expect(describeRecord("local:/p")).toBe("your checkout at /p");
  });
});
