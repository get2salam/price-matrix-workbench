/**
 * Core pricing calculation utilities.
 *
 * Pure functions extracted from the price matrix optimizer so they can be
 * independently unit-tested, reused across components, and migrated to a
 * server-side API without any React dependencies.
 *
 * All functions are side-effect-free and deterministic.
 */

/**
 * Normalise a numeric string that may use European decimal-comma notation.
 *
 * Returns the input with the decimal separator coerced to `.` so the
 * standard `parseFloat` can handle it. Detection rules:
 *   - Both `.` and `,` present → whichever appears LAST is the decimal
 *     (`1.234,56` is EU, `1,234.56` is US).
 *   - Only one comma with 1–2 or 4+ trailing digits → EU decimal (`1234,56`).
 *   - Single comma with exactly 3 trailing digits (e.g. `10,000`) is
 *     ambiguous and left untouched so it is treated as a US thousands
 *     separator by the caller's strip step (existing behaviour).
 *   - Multiple commas with no dot → US thousands (`1,000,000`).
 */
function normalizeDecimalSeparator(str) {
  const lastDot = str.lastIndexOf('.');
  const lastComma = str.lastIndexOf(',');
  if (lastComma === -1) return str;
  if (lastDot !== -1) {
    return lastComma > lastDot
      ? str.replace(/\./g, '').replace(/,/g, '.')
      : str;
  }
  if (str.indexOf(',') !== lastComma) return str;
  const digitsAfter = (str.slice(lastComma + 1).match(/\d/g) || []).length;
  return digitsAfter === 3 ? str : str.replace(',', '.');
}

/**
 * Parse a currency string (e.g. "$1,234.56") into a float.
 *
 * Strips non-numeric characters except decimal point and minus sign.
 * Also recognises three accounting-format negatives commonly emitted by
 * POS and ERP exports for returns and credits:
 *   - Parenthesised:   `($50.00)`, `(1,234.56)`
 *   - Trailing minus:  `50.00-`, `$1,234.56-` (SAP / AS/400 style)
 *   - Trailing `CR`:   `50.00 CR`, `$1,234.56CR` (general-ledger credit memos)
 *
 * The Unicode "minus sign" character (U+2212), which Excel and macOS Numbers
 * emit in place of the ASCII hyphen-minus, is normalised so that values like
 * `−50.00` are recognised as negatives.
 *
 * European decimal-comma notation (e.g. `1.234,56`, `1234,56`) — common in
 * semicolon-delimited POS exports from continental Europe — is normalised to
 * dot-decimal before parsing.
 *
 * @param {string|number|null|undefined} str - Input value to parse.
 * @returns {number} Parsed float, or 0 if parsing fails.
 */
export function parseCurrency(str) {
  if (str === null || str === undefined || str === '') return 0;
  const raw = str.toString().trim().replace(/−/g, '-');
  const isAccountingNegative = /^\(.*\)$/.test(raw);
  const isTrailingMinus = /\d-$/.test(raw);
  const isCreditSuffix = /\d\s*CR$/i.test(raw);
  const normalized = normalizeDecimalSeparator(raw);
  const cleanStr = normalized.replace(/[^0-9.-]+/g, '');
  const value = parseFloat(cleanStr) || 0;
  return isAccountingNegative || isTrailingMinus || isCreditSuffix
    ? -Math.abs(value)
    : value;
}

/**
 * Format a number as a USD currency string.
 *
 * Non-finite or non-numeric inputs (null, undefined, NaN, Infinity) fall
 * back to "$0.00" so the UI never renders "$NaN" cells.
 *
 * @param {number} value - Numeric value to format.
 * @returns {string} Formatted string, e.g. "$1,234.56".
 */
export function formatCurrency(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(safe);
}

/**
 * Format a number as a percentage string with one decimal place.
 *
 * Non-finite or non-numeric inputs (null, undefined, NaN, Infinity) fall
 * back to "0.0%" rather than throwing or rendering "NaN%".
 *
 * @param {number} value - Percentage value (e.g. 12.5 for 12.5%).
 * @returns {string} Formatted string, e.g. "12.5%".
 */
export function formatPercent(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toFixed(1)}%`;
}

/**
 * Calculate a price multiplier from a gross profit percentage.
 *
 * Relationship: GP% = (1 − 1/multiplier) × 100
 * Inverted:     multiplier = 100 / (100 − GP%)
 *
 * @param {number} gp - Gross profit percentage. Valid range: [0, 99.9].
 * @returns {number} Multiplier, always ≥ 1.01.
 */
export function computeMultiplierFromGP(gp) {
  const clamped = Math.max(0, Math.min(gp, 99.9));
  return Math.max(1.01, 100 / (100 - clamped));
}

/**
 * Calculate gross profit percentage from a price multiplier.
 *
 * Relationship: GP% = (1 − 1/multiplier) × 100
 *
 * @param {number} multiplier - Price multiplier. Must be > 0.
 * @returns {number} Gross profit percentage, clamped to [0, 99.9].
 */
export function computeGPFromMultiplier(multiplier) {
  if (!multiplier || multiplier <= 0) return 0;
  return Math.max(0, Math.min(100 - 100 / multiplier, 99.9));
}

/**
 * Calculate the markup percentage from a price multiplier.
 *
 * Markup% = (multiplier − 1) × 100
 *
 * @param {number} multiplier - Price multiplier.
 * @returns {number} Markup as a percentage.
 */
export function computeMarkupFromMultiplier(multiplier) {
  if (!multiplier || multiplier <= 0) return 0;
  return (multiplier - 1) * 100;
}

/**
 * Validate and clamp a multiplier to safe operating bounds.
 *
 * Returns null for non-numeric or non-positive input so the caller can
 * decide whether to keep the previous value.
 *
 * @param {number} value - Raw multiplier value.
 * @param {{ min?: number, max?: number }} [bounds] - Optional bounds override.
 * @returns {number|null} Clamped value, or null if the input is invalid.
 */
export function clampMultiplier(value, bounds = {}) {
  const min = bounds.min ?? 1.01;
  const max = bounds.max ?? 100;
  if (isNaN(value) || value <= 0) return null;
  return Math.max(min, Math.min(value, max));
}

/**
 * Validate and clamp a gross profit percentage to safe bounds.
 *
 * @param {number} value - Raw GP percentage.
 * @returns {number|null} Clamped value, or null if invalid.
 */
export function clampGP(value) {
  if (isNaN(value)) return null;
  return Math.max(0, Math.min(value, 99.9));
}

/**
 * Detect cost range gaps and overlaps in a price matrix.
 *
 * A "gap" means parts in that cost range would not be assigned to any tier.
 * An "overlap" means parts could match multiple tiers (ambiguous assignment).
 *
 * @param {Array<{id: number, minCost: number, maxCost: number}>} matrix
 * @returns {Array<{type: 'gap'|'overlap', from: number, to: number, range: string}>}
 */
export function detectRangeIssues(matrix) {
  const issues = [];
  for (let i = 0; i < matrix.length - 1; i++) {
    const current = matrix[i];
    const next = matrix[i + 1];
    if (current.maxCost === 999999) continue;
    const gap = next.minCost - current.maxCost;
    if (gap > 0.02) {
      issues.push({
        type: 'gap',
        from: i + 1,
        to: i + 2,
        range: `$${current.maxCost.toFixed(2)} to $${next.minCost.toFixed(2)}`,
      });
    } else if (gap < -0.001) {
      issues.push({
        type: 'overlap',
        from: i + 1,
        to: i + 2,
        range: `$${next.minCost.toFixed(2)} to $${current.maxCost.toFixed(2)}`,
      });
    }
  }
  return issues;
}

/**
 * Build a quick matrix health summary for the setup screen.
 *
 * @param {Array<{minCost: number, maxCost: number, multiplier: number, grossProfit: number}>} matrix
 * @returns {{
 *   tierCount: number,
 *   issueCount: number,
 *   averageMultiplier: number,
 *   averageGrossProfit: number,
 *   highestOpenRangeStart: number|null,
 *   hasOpenEndedTier: boolean,
 * }}
 */
export function computeMatrixSummary(matrix) {
  const tierCount = matrix.length;
  const issueCount = detectRangeIssues(matrix).length;
  const averageMultiplier =
    tierCount > 0 ? matrix.reduce((sum, tier) => sum + tier.multiplier, 0) / tierCount : 0;
  const averageGrossProfit =
    tierCount > 0 ? matrix.reduce((sum, tier) => sum + tier.grossProfit, 0) / tierCount : 0;
  const openEndedTier = matrix.find((tier) => tier.maxCost === 999999) ?? null;

  return {
    tierCount,
    issueCount,
    averageMultiplier,
    averageGrossProfit,
    highestOpenRangeStart: openEndedTier ? openEndedTier.minCost : null,
    hasOpenEndedTier: Boolean(openEndedTier),
  };
}

/**
 * Assign parts to matrix tiers and compute aggregate statistics per tier.
 *
 * Each part is assigned to the **first** matching tier only (dedup logic).
 * Revenue share percentages are calculated after all tiers are processed.
 *
 * @param {Array<{unitCost: number, unitRetail: number, qty: number, totalCost: number, totalRetail: number}>} parts
 * @param {Array<{id: number, minCost: number, maxCost: number, multiplier: number, grossProfit: number}>} matrix
 * @returns {Array<Object>} Tier analysis objects with aggregated statistics.
 */
export function computeTierAnalysis(parts, matrix) {
  const assignedIndices = new Set();

  const analysis = matrix.map((tier) => {
    const tierParts = parts.filter((p, idx) => {
      if (assignedIndices.has(idx)) return false;
      if (p.unitCost >= tier.minCost && p.unitCost <= tier.maxCost) {
        assignedIndices.add(idx);
        return true;
      }
      return false;
    });

    const totalCost = tierParts.reduce((sum, p) => sum + p.totalCost, 0);
    const totalRetail = tierParts.reduce((sum, p) => sum + p.totalRetail, 0);
    const totalQty = tierParts.reduce((sum, p) => sum + p.qty, 0);
    const currentMargin =
      totalRetail > 0 ? ((totalRetail - totalCost) / totalRetail) * 100 : 0;
    const currentProfit = totalRetail - totalCost;

    return {
      ...tier,
      partCount: tierParts.length,
      totalQty,
      totalCost,
      totalRetail,
      currentMargin,
      currentProfit,
      revenueShare: 0,
    };
  });

  const totalRevenue = analysis.reduce((sum, t) => sum + t.totalRetail, 0);
  analysis.forEach((tier) => {
    tier.revenueShare =
      totalRevenue > 0 ? (tier.totalRetail / totalRevenue) * 100 : 0;
  });

  return analysis;
}

/**
 * Calculate the overall gross profit margin across all tier analyses.
 *
 * @param {Array<{totalCost: number, totalRetail: number}>} tierAnalysis
 * @returns {number} Overall GP margin as a percentage.
 */
export function computeOverallMargin(tierAnalysis) {
  const totalCost = tierAnalysis.reduce((sum, t) => sum + t.totalCost, 0);
  const totalRetail = tierAnalysis.reduce((sum, t) => sum + t.totalRetail, 0);
  if (totalRetail === 0) return 0;
  return ((totalRetail - totalCost) / totalRetail) * 100;
}

/**
 * Calculate the target profit amount from user-specified inputs.
 *
 * Three modes are supported:
 * - `'percent'` — increase current profit by `targetValue`% (e.g. 10 = +10%)
 * - `'margin'`  — set overall GP margin to `targetValue`% (e.g. 65 = 65% margin)
 * - `'dollar'`  — add a fixed dollar amount to current profit
 *
 * Falls back to a 5% increase if the computed target is invalid.
 *
 * @param {number} currentProfit - Current total profit.
 * @param {number} currentCost   - Current total cost of goods.
 * @param {'percent'|'margin'|'dollar'} targetType - Type of target.
 * @param {number} targetValue   - User-specified target value.
 * @returns {number} Target profit amount (always positive and finite).
 */
export function computeTargetProfit(currentProfit, currentCost, targetType, targetValue) {
  let targetProfit;

  if (targetType === 'percent') {
    targetProfit = currentProfit * (1 + targetValue / 100);
  } else if (targetType === 'margin') {
    const targetMarginDecimal = Math.min(targetValue / 100, 0.95);
    const targetRevenue = currentCost / (1 - targetMarginDecimal);
    targetProfit = targetRevenue - currentCost;
  } else {
    // 'dollar'
    targetProfit = currentProfit + targetValue;
  }

  // Guard against NaN / Infinity / negative
  if (!isFinite(targetProfit) || targetProfit <= 0) {
    return currentProfit * 1.05;
  }

  return targetProfit;
}

/**
 * Check whether a target margin is below the current actual margin.
 *
 * Useful for surfacing a warning before running the optimiser.
 *
 * @param {number} targetMarginPct - User-specified target margin %.
 * @param {Array<{totalCost: number, totalRetail: number}>} tierAnalysis
 * @returns {boolean} True when the target is lower than the current margin.
 */
export function isTargetMarginTooLow(targetMarginPct, tierAnalysis) {
  const currentMargin = computeOverallMargin(tierAnalysis);
  return targetMarginPct < currentMargin;
}
