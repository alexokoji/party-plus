/**
 * P(X >= k) for X ~ Binomial(n, p), computed iteratively to avoid overflow
 * from factorials when n is large (up to ~30 dice in a full room).
 */
export function binomialAtLeast(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;

  const q = 1 - p;
  let term = Math.pow(q, n); // P(X = 0)
  let cumulativeBelowK = term;
  for (let i = 0; i < k - 1; i++) {
    term = term * ((n - i) / (i + 1)) * (p / q);
    cumulativeBelowK += term;
  }
  return Math.max(0, Math.min(1, 1 - cumulativeBelowK));
}
