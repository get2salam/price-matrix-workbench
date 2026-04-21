/**
 * Unit tests for src/utils/pricingUtils.js
 *
 * Tests cover all exported pure functions with edge cases derived from
 * real-world pricing scenarios encountered in auto-parts shop management.
 */

import { describe, it, expect } from 'vitest';
import {
  parseCurrency,
  formatCurrency,
  formatPercent,
  computeMultiplierFromGP,
  computeGPFromMultiplier,
  computeMarkupFromMultiplier,
  clampMultiplier,
  clampGP,
  detectRangeIssues,
  computeMatrixSummary,
  computeTierAnalysis,
  computeOverallMargin,
  computeTargetProfit,
  isTargetMarginTooLow,
} from '../utils/pricingUtils.js';

// ─── parseCurrency ───────────────────────────────────────────────────────────

describe('parseCurrency', () => {
  it('parses plain numbers', () => {
    expect(parseCurrency('12.50')).toBe(12.5);
    expect(parseCurrency('1200')).toBe(1200);
  });

  it('strips dollar signs', () => {
    expect(parseCurrency('$12.50')).toBe(12.5);
  });

  it('strips thousand separators', () => {
    expect(parseCurrency('$1,234.56')).toBe(1234.56);
    expect(parseCurrency('10,000')).toBe(10000);
  });

  it('handles negative values', () => {
    expect(parseCurrency('-50.00')).toBe(-50);
  });

  it('returns 0 for empty string', () => {
    expect(parseCurrency('')).toBe(0);
  });

  it('returns 0 for null', () => {
    expect(parseCurrency(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(parseCurrency(undefined)).toBe(0);
  });

  it('returns 0 for non-numeric text', () => {
    expect(parseCurrency('N/A')).toBe(0);
    expect(parseCurrency('abc')).toBe(0);
  });

  it('handles numeric input directly', () => {
    expect(parseCurrency(42.5)).toBe(42.5);
  });
});

// ─── formatCurrency ──────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  it('formats positive values', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats negative values', () => {
    expect(formatCurrency(-500)).toBe('-$500.00');
  });

  it('rounds to 2 decimal places', () => {
    expect(formatCurrency(1.999)).toBe('$2.00');
  });
});

// ─── formatPercent ───────────────────────────────────────────────────────────

describe('formatPercent', () => {
  it('formats integer percentages', () => {
    expect(formatPercent(75)).toBe('75.0%');
  });

  it('formats decimal percentages', () => {
    expect(formatPercent(63.5)).toBe('63.5%');
  });

  it('rounds to 1 decimal place', () => {
    expect(formatPercent(12.456)).toBe('12.5%');
  });
});

// ─── computeMultiplierFromGP ─────────────────────────────────────────────────

describe('computeMultiplierFromGP', () => {
  it('computes multiplier from known GP values', () => {
    // GP=80% → mult = 100/(100-80) = 5.00
    expect(computeMultiplierFromGP(80)).toBeCloseTo(5.0, 4);
    // GP=50% → mult = 100/(100-50) = 2.00
    expect(computeMultiplierFromGP(50)).toBeCloseTo(2.0, 4);
    // GP=0%  → mult = 1.00 (clamped to 1.01)
    expect(computeMultiplierFromGP(0)).toBeCloseTo(1.01, 2);
  });

  it('clamps GP at 99.9% maximum', () => {
    const mult = computeMultiplierFromGP(99.9);
    expect(mult).toBeCloseTo(1000, -1); // very high but finite
    expect(isFinite(mult)).toBe(true);
  });

  it('returns at least 1.01 for GP=0', () => {
    expect(computeMultiplierFromGP(0)).toBeGreaterThanOrEqual(1.01);
  });

  it('handles negative GP by clamping to 0', () => {
    const mult = computeMultiplierFromGP(-50);
    expect(mult).toBeGreaterThanOrEqual(1.01);
  });
});

// ─── computeGPFromMultiplier ─────────────────────────────────────────────────

describe('computeGPFromMultiplier', () => {
  it('computes GP from known multiplier values', () => {
    // mult=5 → GP = (1-1/5)*100 = 80%
    expect(computeGPFromMultiplier(5)).toBeCloseTo(80, 4);
    // mult=2 → GP = 50%
    expect(computeGPFromMultiplier(2)).toBeCloseTo(50, 4);
    // mult=4.76 → GP ≈ 79%
    expect(computeGPFromMultiplier(4.76)).toBeCloseTo(79, 0);
  });

  it('returns 0 for multiplier of 0 or undefined', () => {
    expect(computeGPFromMultiplier(0)).toBe(0);
    expect(computeGPFromMultiplier(undefined)).toBe(0);
  });

  it('returns 0 for negative multiplier', () => {
    expect(computeGPFromMultiplier(-1)).toBe(0);
  });

  it('never exceeds 99.9%', () => {
    expect(computeGPFromMultiplier(10000)).toBeLessThanOrEqual(99.9);
  });

  it('is the inverse of computeMultiplierFromGP (round-trip)', () => {
    const gp = 63.5;
    const mult = computeMultiplierFromGP(gp);
    expect(computeGPFromMultiplier(mult)).toBeCloseTo(gp, 3);
  });
});

// ─── computeMarkupFromMultiplier ─────────────────────────────────────────────

describe('computeMarkupFromMultiplier', () => {
  it('computes markup correctly', () => {
    // mult=5 → markup = (5-1)*100 = 400%
    expect(computeMarkupFromMultiplier(5)).toBeCloseTo(400, 4);
    // mult=2 → markup = 100%
    expect(computeMarkupFromMultiplier(2)).toBeCloseTo(100, 4);
    // mult=1 → markup = 0%
    expect(computeMarkupFromMultiplier(1)).toBeCloseTo(0, 4);
  });

  it('returns 0 for undefined/null/zero', () => {
    expect(computeMarkupFromMultiplier(0)).toBe(0);
    expect(computeMarkupFromMultiplier(null)).toBe(0);
  });
});

// ─── clampMultiplier ─────────────────────────────────────────────────────────

describe('clampMultiplier', () => {
  it('returns values within range unchanged', () => {
    expect(clampMultiplier(3.5)).toBe(3.5);
  });

  it('clamps below minimum to 1.01', () => {
    expect(clampMultiplier(0.5)).toBe(1.01);
    expect(clampMultiplier(1.0)).toBe(1.01);
  });

  it('clamps above maximum to 100', () => {
    expect(clampMultiplier(150)).toBe(100);
  });

  it('returns null for NaN', () => {
    expect(clampMultiplier(NaN)).toBeNull();
  });

  it('returns null for zero', () => {
    expect(clampMultiplier(0)).toBeNull();
  });

  it('returns null for negative values', () => {
    expect(clampMultiplier(-5)).toBeNull();
  });

  it('respects custom bounds', () => {
    expect(clampMultiplier(1.5, { min: 2.0, max: 5.0 })).toBe(2.0);
    expect(clampMultiplier(10, { min: 2.0, max: 5.0 })).toBe(5.0);
  });
});

// ─── clampGP ─────────────────────────────────────────────────────────────────

describe('clampGP', () => {
  it('passes through valid values', () => {
    expect(clampGP(80)).toBe(80);
    expect(clampGP(0)).toBe(0);
    expect(clampGP(99.9)).toBe(99.9);
  });

  it('clamps values above 99.9', () => {
    expect(clampGP(150)).toBe(99.9);
    expect(clampGP(100)).toBe(99.9);
  });

  it('clamps values below 0', () => {
    expect(clampGP(-50)).toBe(0);
  });

  it('returns null for NaN', () => {
    expect(clampGP(NaN)).toBeNull();
  });
});

// ─── detectRangeIssues ───────────────────────────────────────────────────────

describe('detectRangeIssues', () => {
  const validMatrix = [
    { id: 1, minCost: 0, maxCost: 1.5, multiplier: 5.0, grossProfit: 80 },
    { id: 2, minCost: 1.51, maxCost: 6.0, multiplier: 4.76, grossProfit: 79 },
    { id: 3, minCost: 6.01, maxCost: 999999, multiplier: 3.7, grossProfit: 73 },
  ];

  it('returns no issues for a valid gapless matrix', () => {
    expect(detectRangeIssues(validMatrix)).toHaveLength(0);
  });

  it('detects a gap between tiers', () => {
    const gapped = [
      { id: 1, minCost: 0, maxCost: 1.5, multiplier: 5.0, grossProfit: 80 },
      { id: 2, minCost: 5.0, maxCost: 10.0, multiplier: 3.7, grossProfit: 73 }, // gap: 1.51-4.99
    ];
    const issues = detectRangeIssues(gapped);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('gap');
    expect(issues[0].from).toBe(1);
    expect(issues[0].to).toBe(2);
  });

  it('detects an overlap between tiers', () => {
    const overlapping = [
      { id: 1, minCost: 0, maxCost: 6.0, multiplier: 5.0, grossProfit: 80 },
      { id: 2, minCost: 4.0, maxCost: 10.0, multiplier: 3.7, grossProfit: 73 }, // overlap: 4.0-6.0
    ];
    const issues = detectRangeIssues(overlapping);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('overlap');
  });

  it('ignores gaps after a 999999 maxCost tier', () => {
    const openEndedThen = [
      { id: 1, minCost: 0, maxCost: 999999, multiplier: 5.0, grossProfit: 80 },
      { id: 2, minCost: 1000, maxCost: 2000, multiplier: 2.0, grossProfit: 50 }, // after open-ended
    ];
    expect(detectRangeIssues(openEndedThen)).toHaveLength(0);
  });
});

// ─── computeMatrixSummary ───────────────────────────────────────────────────

describe('computeMatrixSummary', () => {
  it('summarises a healthy matrix', () => {
    const summary = computeMatrixSummary([
      { id: 1, minCost: 0, maxCost: 10, multiplier: 4, grossProfit: 75 },
      { id: 2, minCost: 10.01, maxCost: 999999, multiplier: 2.5, grossProfit: 60 },
    ]);

    expect(summary.tierCount).toBe(2);
    expect(summary.issueCount).toBe(0);
    expect(summary.averageMultiplier).toBeCloseTo(3.25, 2);
    expect(summary.averageGrossProfit).toBeCloseTo(67.5, 2);
    expect(summary.hasOpenEndedTier).toBe(true);
    expect(summary.highestOpenRangeStart).toBe(10.01);
  });

  it('counts range issues in the summary', () => {
    const summary = computeMatrixSummary([
      { id: 1, minCost: 0, maxCost: 10, multiplier: 4, grossProfit: 75 },
      { id: 2, minCost: 12, maxCost: 999999, multiplier: 2.5, grossProfit: 60 },
    ]);

    expect(summary.issueCount).toBe(1);
  });
});

// ─── computeTierAnalysis ─────────────────────────────────────────────────────

describe('computeTierAnalysis', () => {
  const matrix = [
    { id: 1, minCost: 0, maxCost: 1.5, multiplier: 5.0, grossProfit: 80 },
    { id: 2, minCost: 1.51, maxCost: 6.0, multiplier: 4.76, grossProfit: 79 },
    { id: 3, minCost: 6.01, maxCost: 999999, multiplier: 3.7, grossProfit: 73 },
  ];

  const parts = [
    // Tier 1
    { unitCost: 0.5, unitRetail: 2.5, qty: 10, totalCost: 5, totalRetail: 25 },
    // Tier 2
    { unitCost: 3.0, unitRetail: 12.0, qty: 5, totalCost: 15, totalRetail: 60 },
    // Tier 3
    { unitCost: 10.0, unitRetail: 30.0, qty: 2, totalCost: 20, totalRetail: 60 },
  ];

  it('assigns each part to exactly one tier', () => {
    const analysis = computeTierAnalysis(parts, matrix);
    const totalParts = analysis.reduce((sum, t) => sum + t.partCount, 0);
    expect(totalParts).toBe(parts.length);
  });

  it('calculates correct revenue share percentages summing to ~100', () => {
    const analysis = computeTierAnalysis(parts, matrix);
    const totalShare = analysis.reduce((sum, t) => sum + t.revenueShare, 0);
    expect(totalShare).toBeCloseTo(100, 5);
  });

  it('correctly calculates per-tier aggregates', () => {
    const analysis = computeTierAnalysis(parts, matrix);
    const tier1 = analysis[0]; // unitCost=0.5 → Tier 1
    expect(tier1.partCount).toBe(1);
    expect(tier1.totalCost).toBeCloseTo(5, 4);
    expect(tier1.totalRetail).toBeCloseTo(25, 4);
    expect(tier1.currentProfit).toBeCloseTo(20, 4);
    expect(tier1.currentMargin).toBeCloseTo(80, 4);
  });

  it('handles empty parts array', () => {
    const analysis = computeTierAnalysis([], matrix);
    expect(analysis.every((t) => t.partCount === 0)).toBe(true);
    expect(analysis.every((t) => t.revenueShare === 0)).toBe(true);
  });

  it('does not double-assign parts at tier boundaries', () => {
    // Part with unitCost exactly at tier boundary (1.5 = Tier 1 max)
    const boundaryParts = [
      { unitCost: 1.5, unitRetail: 7.5, qty: 1, totalCost: 1.5, totalRetail: 7.5 },
    ];
    const analysis = computeTierAnalysis(boundaryParts, matrix);
    const totalParts = analysis.reduce((sum, t) => sum + t.partCount, 0);
    expect(totalParts).toBe(1);
  });
});

// ─── computeOverallMargin ────────────────────────────────────────────────────

describe('computeOverallMargin', () => {
  it('computes overall GP margin correctly', () => {
    // totalCost=100, totalRetail=250 → margin = 150/250 = 60%
    const analysis = [
      { totalCost: 60, totalRetail: 150 },
      { totalCost: 40, totalRetail: 100 },
    ];
    expect(computeOverallMargin(analysis)).toBeCloseTo(60, 4);
  });

  it('returns 0 when total retail is 0', () => {
    const analysis = [{ totalCost: 100, totalRetail: 0 }];
    expect(computeOverallMargin(analysis)).toBe(0);
  });

  it('handles empty array', () => {
    expect(computeOverallMargin([])).toBe(0);
  });
});

// ─── computeTargetProfit ─────────────────────────────────────────────────────

describe('computeTargetProfit', () => {
  const currentProfit = 10000;
  const currentCost = 25000;

  describe('percent mode', () => {
    it('increases profit by specified percentage', () => {
      const target = computeTargetProfit(currentProfit, currentCost, 'percent', 10);
      expect(target).toBeCloseTo(11000, 4);
    });

    it('handles 0% increase (returns same profit)', () => {
      const target = computeTargetProfit(currentProfit, currentCost, 'percent', 0);
      expect(target).toBeCloseTo(10000, 4);
    });

    it('handles 100% increase (doubles profit)', () => {
      const target = computeTargetProfit(currentProfit, currentCost, 'percent', 100);
      expect(target).toBeCloseTo(20000, 4);
    });
  });

  describe('dollar mode', () => {
    it('adds fixed dollar amount to current profit', () => {
      const target = computeTargetProfit(currentProfit, currentCost, 'dollar', 2500);
      expect(target).toBeCloseTo(12500, 4);
    });

    it('handles $0 additional profit', () => {
      const target = computeTargetProfit(currentProfit, currentCost, 'dollar', 0);
      expect(target).toBeCloseTo(10000, 4);
    });
  });

  describe('margin mode', () => {
    it('computes target profit for a given margin %', () => {
      // currentCost=25000, targetMargin=70%
      // targetRevenue = 25000 / (1-0.70) = 83333.33
      // targetProfit  = 83333.33 - 25000 = 58333.33
      const target = computeTargetProfit(currentProfit, currentCost, 'margin', 70);
      expect(target).toBeCloseTo(58333.33, 0);
    });

    it('caps margin at 95% to prevent Infinity', () => {
      // margin=100% would give Infinity — should be capped
      const target = computeTargetProfit(currentProfit, currentCost, 'margin', 100);
      expect(isFinite(target)).toBe(true);
    });
  });

  describe('fallback behaviour', () => {
    it('falls back to 5% increase for invalid (negative) result', () => {
      // percent = -200 would produce negative profit → fallback
      const target = computeTargetProfit(currentProfit, currentCost, 'percent', -200);
      expect(target).toBeCloseTo(currentProfit * 1.05, 4);
    });
  });
});

// ─── isTargetMarginTooLow ────────────────────────────────────────────────────

describe('isTargetMarginTooLow', () => {
  // Setup: currentCost=100, currentRetail=250 → currentMargin = 60%
  const tierAnalysis = [{ totalCost: 100, totalRetail: 250 }];

  it('returns true when target < current margin', () => {
    expect(isTargetMarginTooLow(50, tierAnalysis)).toBe(true);
  });

  it('returns false when target > current margin', () => {
    expect(isTargetMarginTooLow(70, tierAnalysis)).toBe(false);
  });

  it('returns false when target equals current margin (boundary)', () => {
    expect(isTargetMarginTooLow(60, tierAnalysis)).toBe(false);
  });
});
