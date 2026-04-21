/**
 * Unit tests for CLI shared helpers — specifically, the error formatter that
 * users see. Regression coverage for BUG-001 / BUG-005: Node's `fetch` wraps
 * the real network reason in `err.cause`, and we must surface it so the user
 * sees more than "fetch failed".
 */
import { describe, it, expect } from "vitest";
import { formatError } from "../../src/cli/shared.js";

describe("formatError", () => {
  it("renders a plain error with the [ERROR] prefix", () => {
    expect(formatError(new Error("boom"))).toBe("[ERROR] boom");
  });

  it("uses the error code as prefix when present", () => {
    const err = Object.assign(new Error("not found"), { code: "NOT_REGISTERED" });
    expect(formatError(err)).toBe("[NOT_REGISTERED] not found");
  });

  it("renders an HTTP status prefix when only .status is present", () => {
    const err = Object.assign(new Error("bad gateway"), { status: 502 });
    expect(formatError(err)).toBe("[HTTP 502] bad gateway");
  });

  // Regression: BUG-001 — fetch() wraps the real reason in err.cause; users
  // saw only "fetch failed" with no indication of ECONNREFUSED / ENOTFOUND.
  it("surfaces a network cause with code + message", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:1"),
      { code: "ECONNREFUSED" },
    );
    expect(formatError(err)).toBe(
      "[ERROR] fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:1)",
    );
  });

  it("follows nested causes up to a small depth", () => {
    const deepest = Object.assign(new Error("dns lookup failed"), {
      code: "ENOTFOUND",
    });
    const middle = Object.assign(new Error("connect failed"), {
      code: "UND_ERR_CONNECT",
      cause: deepest,
    });
    const top = Object.assign(new TypeError("fetch failed"), { cause: middle });
    const out = formatError(top);
    expect(out).toMatch(/\[ERROR\] fetch failed/);
    expect(out).toContain("UND_ERR_CONNECT: connect failed");
    expect(out).toContain("ENOTFOUND: dns lookup failed");
  });

  it("falls back to Unknown error for non-Error values", () => {
    expect(formatError("nope")).toBe("Unknown error: nope");
  });
});
