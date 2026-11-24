import { describe, expect, it, vi } from "vitest";

import {
  PAGE_SECRET_HEADER,
  PAGE_SECRET_KEY,
  pageSecret,
  pageSecretRefusal,
  takePageSecretFromUrl,
  withPageSecret,
} from "./pageSecret";

// The suite runs on node: the address, history and storage are fakes.
function fakes(hash: string, pathname = "/", search = "") {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const replaceState = vi.fn();
  return { loc: { hash, pathname, search }, hist: { replaceState, state: { s: 1 } }, storage, store, replaceState };
}

describe("the page secret (#381)", () => {
  it("takes the secret from the link's fragment and strips it from the address bar", () => {
    const f = fakes("#pnv-session=abc_DEF-123", "/", "?x=1");
    expect(takePageSecretFromUrl(f.loc, f.hist, f.storage)).toBe(true);
    expect(f.store.get(PAGE_SECRET_KEY)).toBe("abc_DEF-123");
    expect(f.replaceState).toHaveBeenCalledWith({ s: 1 }, "", "/?x=1");
    expect(pageSecret(f.storage)).toBe("abc_DEF-123");
  });

  it("keeps the rest of the fragment", () => {
    const f = fakes("#a=1&pnv-session=s3cret&b");
    expect(takePageSecretFromUrl(f.loc, f.hist, f.storage)).toBe(true);
    expect(f.replaceState).toHaveBeenCalledWith({ s: 1 }, "", "/#a=1&b");
  });

  it("leaves an address without the secret alone", () => {
    for (const hash of ["", "#", "#other=1"]) {
      const f = fakes(hash);
      expect(takePageSecretFromUrl(f.loc, f.hist, f.storage)).toBe(false);
      expect(f.replaceState).not.toHaveBeenCalled();
      expect(pageSecret(f.storage)).toBeNull();
    }
  });

  it("strips an empty secret but keeps nothing", () => {
    const f = fakes("#pnv-session=");
    expect(takePageSecretFromUrl(f.loc, f.hist, f.storage)).toBe(false);
    expect(f.replaceState).toHaveBeenCalledWith({ s: 1 }, "", "/");
    expect(pageSecret(f.storage)).toBeNull();
  });

  it("a new link replaces the secret from an earlier launch", () => {
    const f = fakes("#pnv-session=new");
    f.store.set(PAGE_SECRET_KEY, "old");
    takePageSecretFromUrl(f.loc, f.hist, f.storage);
    expect(pageSecret(f.storage)).toBe("new");
  });

  it("adds the header to a request, keeping its own headers", () => {
    const init = withPageSecret({ method: "PUT", headers: { "Content-Type": "application/json" } }, "s");
    const headers = new Headers(init.headers);
    expect(headers.get(PAGE_SECRET_HEADER)).toBe("s");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.method).toBe("PUT");
    expect(withPageSecret({ method: "GET" }, null)).toEqual({ method: "GET" });
  });

  it("recognises the backend's page-secret refusals only", () => {
    const msg = "Refused: this page doesn't hold this launch's assistant secret.";
    expect(pageSecretRefusal({ detail: { reason: "page_secret_missing", message: msg } })).toBe(msg);
    expect(pageSecretRefusal({ detail: { reason: "page_secret_wrong", message: "m" } })).toBe("m");
    expect(pageSecretRefusal({ detail: { reason: "unavailable", message: "m" } })).toBeNull();
    expect(pageSecretRefusal({ detail: "unavailable_in_deployment" })).toBeNull();
  });
});
