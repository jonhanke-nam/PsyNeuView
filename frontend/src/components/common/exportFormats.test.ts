import { describe, it, expect } from "vitest";
import {
  SAVE_FORMATS,
  getFormatById,
  describeDestinations,
} from "./exportFormats";

describe("save formats", () => {
  it("offers .py alongside the bundle and MDF formats", () => {
    // .py used to live outside the registry because it was the one format that
    // could not be downloaded (#1067).
    expect(SAVE_FORMATS.map((f) => f.id)).toEqual([
      "py",
      "pnlproject",
      "mdf-yaml",
      "mdf-json",
    ]);
  });

  it("downloads .py without a round trip", () => {
    // The editor buffer is already in the browser; a download endpoint would
    // only fetch back what we have.
    expect(getFormatById("py")?.downloadEndpoint).toBeUndefined();
  });

  it("gives every other format a download endpoint", () => {
    for (const f of SAVE_FORMATS.filter((f) => f.id !== "py")) {
      expect(f.downloadEndpoint, f.id).toBeTruthy();
    }
  });

  it("builds filenames off the model name, not the full path", () => {
    expect(getFormatById("pnlproject")?.buildFilename("/a/b/stroop.py")).toBe(
      "stroop.pnlproject",
    );
    expect(getFormatById("py")?.buildFilename("/a/b/stroop.py")).toBe("stroop.py");
  });
});

describe("destination wording", () => {
  it("names the server as a different computer when it is one", () => {
    for (const mode of ["container", "hosted"]) {
      const d = describeDestinations(mode);
      expect(d.remote).toBe(true);
      expect(d.server.label).toBe("On the server");
      expect(d.server.hint).toMatch(/not on your computer/i);
    }
  });

  it("does not claim a remote server when the backend is local", () => {
    // Locally the "server" is the user's own machine — saying otherwise would
    // be a new, opposite lie.
    for (const mode of ["local", "mac_app"]) {
      const d = describeDestinations(mode);
      expect(d.remote).toBe(false);
      expect(d.server.label).toMatch(/this computer/i);
      expect(d.server.hint).not.toMatch(/not on your computer/i);
    }
  });

  it("falls back to local wording when the backend reports no mode", () => {
    // Backends predating the deployment block (#1062) send nothing; the
    // neutral choice must not imply a remote server that may not exist.
    const d = describeDestinations(undefined);
    expect(d.remote).toBe(false);
    expect(d.server.label).toMatch(/this computer/i);
  });

  it("always offers download as a distinct destination", () => {
    for (const mode of [undefined, "local", "container"]) {
      expect(describeDestinations(mode).download.label).toBe(
        "Download to my computer",
      );
    }
  });
});
