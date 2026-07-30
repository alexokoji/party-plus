import { describe, it, expect } from "vitest";
import { binomialAtLeast } from "./probability";

describe("binomialAtLeast", () => {
  it("returns 1 when k <= 0", () => {
    expect(binomialAtLeast(10, 0, 1 / 6)).toBe(1);
    expect(binomialAtLeast(10, -3, 1 / 6)).toBe(1);
  });

  it("returns 0 when k > n", () => {
    expect(binomialAtLeast(5, 6, 1 / 6)).toBe(0);
  });

  it("matches P(X=1) = 1-(1-p)^n for k=1", () => {
    const n = 8;
    const p = 1 / 6;
    const expected = 1 - Math.pow(1 - p, n);
    expect(binomialAtLeast(n, 1, p)).toBeCloseTo(expected, 10);
  });

  it("P(X>=k) is non-increasing in k", () => {
    const n = 12;
    const p = 2 / 6;
    let prev = 1;
    for (let k = 0; k <= n; k++) {
      const cur = binomialAtLeast(n, k, p);
      expect(cur).toBeLessThanOrEqual(prev + 1e-9);
      prev = cur;
    }
  });

  it("P(X>=n) equals p^n", () => {
    const n = 5;
    const p = 2 / 6;
    expect(binomialAtLeast(n, n, p)).toBeCloseTo(Math.pow(p, n), 10);
  });

  it("stays within [0,1] for a large n", () => {
    const result = binomialAtLeast(30, 10, 2 / 6);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
