/**
 * screener.in publishes two financial sets per company: standalone (the parent
 * company on its own) and consolidated (parent + subsidiaries). Every P/E
 * quoted anywhere for a group company is the consolidated one - the standalone
 * set leaves the subsidiaries out entirely.
 *
 * metricsSync used to prefer standalone wherever a standalone file existed,
 * which is why stock_metrics carried a P/E of 42.9 for RELIANCE against
 * screener.in's consolidated 23.8 (standalone EPS 28.98 vs consolidated 59.7 -
 * no Jio, no Retail). Same shape for BHARTIARTL (86.1 vs 38.8) and LT
 * (73.9 vs 31.9). Companies with no meaningful subsidiaries were unaffected,
 * which is why only *some* stocks looked wrong.
 *
 * Consolidated is now the default and standalone the fallback, for the
 * companies that publish no consolidated statements at all.
 */

/** Picks the consolidated value, falling back to standalone when it isn't usable. */
export function pickVariant<T>(
  consolidated: T,
  standalone: T,
  usable: (value: T) => boolean
): T {
  if (usable(consolidated)) return consolidated;
  if (usable(standalone)) return standalone;
  // Neither is usable - hand back the consolidated value so the caller's own
  // "missing" handling (pe stays 0, Yahoo fallback fires) sees a stable shape.
  return consolidated;
}

/**
 * For figures where a non-positive value means "absent", not "bad news":
 * P/E is undefined on negative earnings, so a loss-making EPS is no more
 * usable here than a missing one.
 */
export const isPositive = (n: number): boolean => Number.isFinite(n) && n > 0;

/**
 * For figures where a negative value is real data worth keeping - a loss-making
 * quarter's net profit, or a negative ROCE.
 */
export const isNonZero = (n: number): boolean => Number.isFinite(n) && n !== 0;
