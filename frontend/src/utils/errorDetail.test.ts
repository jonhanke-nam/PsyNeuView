import { describe, it, expect } from "vitest";
import { errorDetail } from "./errorDetail";

function reply(body: string, status = 500, statusText = "Internal Server Error") {
  return { text: async () => body, status, statusText };
}

describe("errorDetail (#1396)", () => {
  it("uses the detail of a JSON error", async () => {
    expect(await errorDetail(reply(JSON.stringify({ detail: "module 'psyneulink' has no attribute 'Composition'" }))))
      .toBe("module 'psyneulink' has no attribute 'Composition'");
  });

  it("shows a plain-text reply as it is, instead of a JSON parse error", async () => {
    expect(await errorDetail(reply("Internal Server Error"))).toBe("Internal Server Error");
  });

  it("writes out a detail that isn't a string (a validation error list)", async () => {
    expect(await errorDetail(reply(JSON.stringify({ detail: [{ msg: "field required" }] }), 422)))
      .toBe('[{"msg":"field required"}]');
  });

  it("falls back to the status when the body is empty or unreadable", async () => {
    expect(await errorDetail(reply("", 502, "Bad Gateway"))).toBe("Bad Gateway");
    expect(await errorDetail({ text: async () => { throw new Error("gone"); }, status: 504, statusText: "" })).toBe("HTTP 504");
  });
});
