import React, { Suspense, useState, useEffect, useRef } from 'react';
import { parseCSV } from './utils/csvParser';
import { computeMatrixSummary, computeTierAnalysis, detectRangeIssues, formatCurrency, formatPercent } from './utils/pricingUtils';

// Default matrix based on the screenshot provided
const defaultMatrix = [
  { id: 1, minCost: 0, maxCost: 1.50, multiplier: 5.00, grossProfit: 80 },
  { id: 2, minCost: 1.51, maxCost: 6.00, multiplier: 4.76, grossProfit: 79 },
  { id: 3, minCost: 6.01, maxCost: 10.00, multiplier: 3.70, grossProfit: 73 },
  { id: 4, minCost: 10.01, maxCost: 30.00, multiplier: 3.33, grossProfit: 70 },
  { id: 5, minCost: 30.01, maxCost: 50.00, multiplier: 2.86, grossProfit: 65 },
  { id: 6, minCost: 50.01, maxCost: 150.00, multiplier: 2.70, grossProfit: 63 },
  { id: 7, minCost: 150.01, maxCost: 250.00, multiplier: 2.50, grossProfit: 60 },
  { id: 8, minCost: 250.01, maxCost: 999999, multiplier: 2.13, grossProfit: 53 },
];

const targetPresets = {
  percent: [5, 10, 15],
  margin: [55, 60, 65],
  dollar: [500, 1000, 2500],
};

const LazyChartSection = React.lazy(() => import('./components/ChartSection'));

export default function PriceMatrixOptimizer() {
  const IS_TRIAL_MODE = false;

  const [step, setStep] = useState(1);
  
  // Initialize matrix from localStorage or use default
  const [matrix, setMatrix] = useState(() => {
    try {
      const savedMatrix = localStorage.getItem('priceMatrix');
      if (savedMatrix) {
        const parsed = JSON.parse(savedMatrix);
        // Validate it's an array with expected structure
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(t =>
            typeof t.minCost === 'number' && typeof t.maxCost === 'number' &&
            typeof t.multiplier === 'number' && t.multiplier > 0
        )) {
          return parsed;
        }
      }
    } catch {
      // ignore JSON parse errors - fall back to defaultMatrix
    }
    return defaultMatrix;
  });
  const [partsData, setPartsData] = useState([]);
  const [tierAnalysis, setTierAnalysis] = useState([]);
  const [targetIncrease, setTargetIncrease] = useState(5);
  const [targetType, setTargetType] = useState('percent');
  const [recommendations, setRecommendations] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [skippedCount, setSkippedCount] = useState(0);

  // NEW: State for manual tier overrides (Request #2)
  const [lockedTiers, setLockedTiers] = useState({}); // { tierId: customMultiplier }

  // CRITICAL: Store original target profit to maintain it during manual edits
  const [originalTargetProfit, setOriginalTargetProfit] = useState(null);

  // Ref to suppress onBlur during reset (Bug 10 fix)
  const isResettingRef = useRef(false);

  // Bug 16: Ref to track partsData without causing re-render loops
  const partsDataRef = useRef([]);

  const [copied, setCopied] = useState(false);

  // Save matrix to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('priceMatrix', JSON.stringify(matrix));
    } catch {
      // ignore localStorage write errors (e.g. private browsing quota exceeded)
    }
  }, [matrix]);

  // Bug 16: Keep partsData ref in sync
  useEffect(() => {
    partsDataRef.current = partsData;
  }, [partsData]);

  // Add a new tier to the matrix
  const addTier = () => {
    if (matrix.length >= 10) return;
    const lastTier = matrix[matrix.length - 1];
    const newTier = {
      id: matrix.length + 1,
      minCost: lastTier.maxCost === 999999 ? lastTier.minCost + 100 : lastTier.maxCost + 0.01,
      maxCost: 999999,
      multiplier: 2.0,
      grossProfit: 50
    };
    // Update the previous last tier's max
    const updatedMatrix = matrix.map((tier, idx) => {
      if (idx === matrix.length - 1) {
        return { ...tier, maxCost: newTier.minCost - 0.01 };
      }
      return tier;
    });
    setMatrix([...updatedMatrix, newTier]);
  };

  // Remove a tier
  const removeTier = (id) => {
    if (matrix.length <= 2) return;
    setMatrix(matrix.filter(t => t.id !== id).map((t, idx) => ({ ...t, id: idx + 1 })));
  };

  // Update a tier's values
  // Bug 18: Don't recalculate GP if multiplier is invalid
  // Bug 20: Clamp GP to [0, 99.9], multiplier to [1.01, 100]
  const updateTier = (id, field, value) => {
    setMatrix(prev => prev.map(tier => {
      if (tier.id !== id) return tier;
      const parsedValue = parseFloat(value);

      if (field === 'grossProfit') {
        // Bug 18: If value is NaN or invalid, keep previous values
        if (isNaN(parsedValue)) return tier;
        // Bug 20: Clamp GP to [0, 99.9]
        const clampedGP = Math.max(0, Math.min(parsedValue, 99.9));
        const newMultiplier = Math.max(1.01, 100 / (100 - clampedGP));
        return { ...tier, grossProfit: clampedGP, multiplier: parseFloat(newMultiplier.toFixed(4)) };
      } else if (field === 'multiplier') {
        // Bug 18: If multiplier is NaN, <= 0, keep previous values
        if (isNaN(parsedValue) || parsedValue <= 0) return tier;
        // Bug 20: Clamp multiplier to [1.01, 100]
        const clampedMult = Math.max(1.01, Math.min(parsedValue, 100));
        // Bug 18: Ensure GP is never negative
        const newGP = Math.max(0, 100 - (100 / clampedMult));
        return { ...tier, multiplier: clampedMult, grossProfit: parseFloat(newGP.toFixed(1)) };
      } else {
        return { ...tier, [field]: parsedValue || 0 };
      }
    }));
  };

  // Bug 17: Auto-fix cost range gaps on blur — set next tier's minCost to current maxCost + 0.01
  const handleMaxCostBlur = (id) => {
    setMatrix(prev => {
      const sorted = [...prev];
      const tierIndex = sorted.findIndex(t => t.id === id);
      if (tierIndex === -1 || tierIndex >= sorted.length - 1) return prev;
      const currentMax = sorted[tierIndex].maxCost;
      if (currentMax === 999999) return prev;
      const nextMin = parseFloat((currentMax + 0.01).toFixed(2));
      return sorted.map((tier, idx) => {
        if (idx === tierIndex + 1 && tier.minCost !== nextMin) {
          return { ...tier, minCost: nextMin };
        }
        return tier;
      });
    });
  };

  // Bug 17: Detect cost range gaps and overlaps
  const rangeIssues = React.useMemo(() => detectRangeIssues(matrix), [matrix]);
  const matrixSummary = React.useMemo(() => computeMatrixSummary(matrix), [matrix]);

  // Parse CSV file
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setError('');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { parts, skippedCount: skippedRows, error: parseError } = parseCSV(String(e.target?.result ?? ''));

        if (parseError) {
          setSkippedCount(0);
          setError(parseError);
          return;
        }

        if (parts.length === 0) {
          setSkippedCount(skippedRows);
          setError('No valid parts data found. Please check your CSV format. Make sure you have a "Unit Cost" column with numeric values.');
          return;
        }

        setSkippedCount(skippedRows);
        setPartsData(parts);
        analyzeTiers(parts);
      } catch (err) {
        console.error('CSV parsing error:', err);
        setError('Error parsing CSV file. Please ensure it is properly formatted. Tip: Try re-exporting from your POS system.');
      }
    };
    reader.readAsText(file);
  };

  // Analyze parts by tier — delegates to pure module-level computeTierAnalysis
  // Bug 17: Dedup logic — each part assigned to the FIRST matching tier only
  const analyzeTiers = (parts) => {
    setTierAnalysis(computeTierAnalysis(parts, matrix));
  };

  // Bug 16: Re-run tier analysis when matrix changes and parts data exists
  useEffect(() => {
    if (partsDataRef.current.length > 0) {
      setTierAnalysis(computeTierAnalysis(partsDataRef.current, matrix));
    }
  }, [matrix]);

  // Calculate optimization recommendations - WITH TARGET ENFORCER
  // overrideLockedTiers: Optional parameter to bypass async state issues
  const calculateRecommendations = (overrideLockedTiers = null, overrideOriginalTarget = undefined) => {
    setIsAnalyzing(true);

    // Use override if provided, otherwise use state
    const effectiveLockedTiers = overrideLockedTiers !== null ? overrideLockedTiers : lockedTiers;
    const isManualEdit = overrideLockedTiers !== null && Object.keys(overrideLockedTiers).length > 0;
    const effectiveOriginalTarget = overrideOriginalTarget !== undefined ? overrideOriginalTarget : originalTargetProfit;


    // 1. Calculate current totals
    const currentTotalProfit = tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0);
    const currentTotalRevenue = tierAnalysis.reduce((sum, t) => sum + t.totalRetail, 0);
    const currentTotalCost = tierAnalysis.reduce((sum, t) => sum + t.totalCost, 0);

    // 2. Calculate target profit
    let targetProfit;

    if (isManualEdit && effectiveOriginalTarget !== null) {
      // CRITICAL FIX: When user manually edits, use the ORIGINAL target
      // Don't recalculate it, or target will change!
      targetProfit = effectiveOriginalTarget;
    } else {
      // First run: Calculate target based on user's input
      if (targetType === 'percent') {
        targetProfit = currentTotalProfit * (1 + targetIncrease / 100);
      } else if (targetType === 'margin') {
        const targetMarginDecimal = Math.min(targetIncrease / 100, 0.95); // Cap margin at 95%
        const targetRevenue = currentTotalCost / (1 - targetMarginDecimal);
        targetProfit = targetRevenue - currentTotalCost;
      } else {
        targetProfit = currentTotalProfit + targetIncrease;
      }

      // Guard against NaN/Infinity/negative targets
      if (!isFinite(targetProfit) || targetProfit <= 0) {
        targetProfit = currentTotalProfit * 1.05; // Fallback: 5% increase
      }

      // Store original target for future manual edits
      setOriginalTargetProfit(targetProfit);
    }

    // 3. Initial calculation (smart weighted distribution)
    const currentActualOverallMultiplier = currentTotalCost > 0 ? (currentTotalRevenue / currentTotalCost) : 1;
    const targetOverallMultiplier = currentTotalCost > 0 ? (1 + (targetProfit / currentTotalCost)) : 1;
    const multiplierIncreaseRatio = targetOverallMultiplier / currentActualOverallMultiplier;

    let optimizedTiers = tierAnalysis.map(tier => {
      if (tier.totalCost <= 0 || tier.totalRetail <= 0) {
        return {
          ...tier,
          newMultiplier: tier.multiplier,
          newGrossProfit: tier.grossProfit,
          multiplierChange: 0,
          marginChange: 0,
          projectedProfit: 0,
          impactScore: 0,
          currentActualMultiplier: tier.multiplier,
          isLocked: false
        };
      }

      // Calculate ACTUAL current multiplier for this tier
      const currentActualMultiplier = tier.totalRetail / tier.totalCost;
      const currentActualMargin = ((tier.totalRetail - tier.totalCost) / tier.totalRetail) * 100;

      // CHECK FOR MANUAL LOCK (Request #2: Editable Results)
      if (effectiveLockedTiers[tier.id]) {
        const lockedMultiplier = effectiveLockedTiers[tier.id];
        const lockedGrossProfit = 100 - (100 / lockedMultiplier);


        // Calculate projected profit with locked multiplier (guard division by zero)
        const projectedActualMultiplier = tier.multiplier > 0
          ? currentActualMultiplier * (lockedMultiplier / tier.multiplier)
          : lockedMultiplier;
        const projectedRevenue = tier.totalCost * projectedActualMultiplier;
        const projectedProfit = projectedRevenue - tier.totalCost;

        return {
          ...tier,
          currentActualMultiplier,
          newMultiplier: lockedMultiplier,
          newGrossProfit: parseFloat(lockedGrossProfit.toFixed(1)),
          projectedProfit: projectedProfit,
          isLocked: true
        };
      }

      // Weight factors: 60% volume, 40% headroom
      const volumeWeight = tier.revenueShare / 100;
      const headroomWeight = 1 - (currentActualMargin / 100);
      const combinedWeight = (volumeWeight * 0.6) + (headroomWeight * 0.4);

      // Calculate percentage increase needed
      const baseIncrease = (multiplierIncreaseRatio - 1);
      const weightedIncrease = baseIncrease * (0.5 + combinedWeight);

      // Apply increase to MATRIX (not actual)
      let newMatrixMultiplier = tier.multiplier * (1 + weightedIncrease);

      // Safety caps
      newMatrixMultiplier = Math.max(newMatrixMultiplier, tier.multiplier); // NEVER decrease
      newMatrixMultiplier = Math.min(newMatrixMultiplier, tier.multiplier * 1.5); // Max 50% increase

      // Calculate new gross profit %
      let newGrossProfit = 100 - (100 / newMatrixMultiplier);
      if (newGrossProfit > 95) {
        newGrossProfit = 95;
        newMatrixMultiplier = 20.0; // 95% GP = 20x multiplier
      }

      // Calculate projected profit (guard division by zero)
      const actualSalesMultiplier = currentActualMultiplier;
      const projectedActualMultiplier = tier.multiplier > 0
        ? actualSalesMultiplier * (newMatrixMultiplier / tier.multiplier)
        : newMatrixMultiplier;
      const projectedRevenue = tier.totalCost * projectedActualMultiplier;
      const projectedProfit = projectedRevenue - tier.totalCost;

      return {
        ...tier,
        currentActualMultiplier,
        newMultiplier: parseFloat(newMatrixMultiplier.toFixed(2)),
        newGrossProfit: parseFloat(newGrossProfit.toFixed(1)),
        projectedProfit: projectedProfit,
        isLocked: false
      };
    });

    // 4. TARGET ENFORCER - Iteratively nudge tiers until we hit the target
    let projectedTotalProfit = optimizedTiers.reduce((sum, t) => sum + t.projectedProfit, 0);
    let attempts = 0;
    const MAX_ATTEMPTS = 50; // Set to 50 for complex scenarios with multiple locked tiers and caps
    const TOLERANCE = 0.005; // Within 0.5% of target (on either side)


    // CRITICAL FIX: Bidirectional loop - adjust UP or DOWN based on gap
    const absoluteTolerance = Math.max(targetProfit * TOLERANCE, 0.01); // Prevent zero tolerance
    while (Math.abs(projectedTotalProfit - targetProfit) > absoluteTolerance && attempts < MAX_ATTEMPTS) {
      const gap = targetProfit - projectedTotalProfit;
      const isUnder = gap > 0;
      const adjustableCount = optimizedTiers.filter(t => !t.isLocked && t.totalCost > 0).length;

      // Early exit if no tiers can be adjusted
      if (adjustableCount === 0) {
        break;
      }

      // OPTIMIZATION: Dynamic step sizing based on gap magnitude
      // If gap is huge (>5%), take bigger steps (1.5%) to converge faster
      // If gap is small (<5%), take smaller steps (0.5%) for precision
      const gapPercent = Math.abs(gap / targetProfit);
      const stepSize = gapPercent > 0.05 ? 0.015 : 0.005;


      optimizedTiers = optimizedTiers.map(tier => {
        if (tier.totalCost <= 0) return tier;

        // Skip locked tiers (user's manual overrides)
        if (tier.isLocked) {
          return tier;
        }

        // Skip tiers that can't be adjusted further
        if (isUnder) {
          // Trying to increase - skip if at caps
          const isAtMarginCap = tier.newGrossProfit >= 95;
          const isAtIncreaseCap = tier.newMultiplier >= tier.multiplier * 1.5;
          if (isAtMarginCap || isAtIncreaseCap) return tier;
        } else {
          // Trying to decrease - skip if at minimum
          if (tier.newMultiplier <= tier.multiplier) return tier;
        }

        // Nudge in the appropriate direction with DYNAMIC step size
        let nudge;
        if (isUnder) {
          nudge = tier.newMultiplier * (1 + stepSize);  // Dynamic increase
        } else {
          nudge = tier.newMultiplier * (1 - stepSize);  // Dynamic decrease
        }

        // Apply safety caps
        nudge = Math.max(nudge, tier.multiplier);  // Never below original
        nudge = Math.min(nudge, tier.multiplier * 1.5);  // Never above 50% increase

        let gp = 100 - (100 / nudge);
        if (gp > 95) {
          gp = 95;
          nudge = 20.0;
        }

        // Recalculate profit for this tier
        const actualSalesMultiplier = tier.currentActualMultiplier;
        const projectedActualMultiplier = tier.multiplier > 0
          ? actualSalesMultiplier * (nudge / tier.multiplier)
          : nudge;
        const projectedProfit = (tier.totalCost * projectedActualMultiplier) - tier.totalCost;

        return {
          ...tier,
          newMultiplier: parseFloat(nudge.toFixed(2)),
          newGrossProfit: parseFloat(gp.toFixed(1)),
          projectedProfit: projectedProfit
        };
      });

      projectedTotalProfit = optimizedTiers.reduce((sum, t) => sum + t.projectedProfit, 0);
      attempts++;
    }

    // 5. Final polish - add change calculations and diagnostics
    const finalTiers = optimizedTiers.map(tier => {
      const multiplierChange = tier.newMultiplier - tier.multiplier;
      const marginChange = tier.newGrossProfit - tier.grossProfit;
      const pricingGap = tier.multiplier - tier.currentActualMultiplier;

      return {
        ...tier,
        newMultiplier: Math.round(tier.newMultiplier * 100) / 100,
        newGrossProfit: Math.round(tier.newGrossProfit * 10) / 10,
        multiplierChange: Math.round(multiplierChange * 100) / 100,
        marginChange: Math.round(marginChange * 10) / 10,
        projectedProfit: Math.round(tier.projectedProfit * 100) / 100,
        impactScore: Math.abs(marginChange) * (tier.revenueShare / 100),
        actualMultiplier: Math.round(tier.currentActualMultiplier * 100) / 100,
        pricingGap: Math.round(pricingGap * 100) / 100,
        isPricingBelowMatrix: pricingGap > 0.1
      };
    });

    setRecommendations({
      currentProfit: currentTotalProfit,
      targetProfit,
      projectedProfit: projectedTotalProfit,
      profitIncrease: projectedTotalProfit - currentTotalProfit,
      percentIncrease: currentTotalProfit > 0 ? ((projectedTotalProfit - currentTotalProfit) / currentTotalProfit) * 100 : 0,
      tiers: finalTiers,
      currentRevenue: currentTotalRevenue,
      currentCost: currentTotalCost
    });

    setIsAnalyzing(false);
    setStep(4);
  };

  // Handle manual tier editing (Request #2: Editable Results)
  const handleManualTierChange = (tierId, newMultiplierValue) => {
    // Skip if reset is in progress (prevents onBlur firing before reset completes)
    if (isResettingRef.current) return;

    const val = parseFloat(newMultiplierValue);

    // Validation: Must be between 1.01x and 20x
    if (isNaN(val) || val < 1.01 || val > 20) {
      return;
    }

    // Lower bound protection: prevent massive profit collapse (Bug 5)
    const originalTier = matrix.find(t => t.id === tierId);
    const minAllowed = originalTier ? Math.max(originalTier.multiplier * 0.5, 1.01) : 1.01;
    const clampedVal = Math.max(val, minAllowed);

    // Update locked tiers
    const newLocks = { ...lockedTiers, [tierId]: clampedVal };
    setLockedTiers(newLocks);

    // CRITICAL FIX: Pass newLocks directly to avoid async state issue
    // React state updates are async, so we can't rely on lockedTiers being updated
    calculateRecommendations(newLocks);
  };

  // FIX: Helper to allow smooth typing without lag, and support Reset button
  const _handleTyping = (tierId, val) => {
    const parsed = parseFloat(val);
    setRecommendations(prev => ({
      ...prev,
      tiers: prev.tiers.map(t => {
        if (t.id !== tierId) return t;
        const newMult = parsed || t.newMultiplier;
        // Also update GP% so it stays in sync during typing (Bug 3 fix)
        const newGP = newMult > 0 ? 100 - (100 / newMult) : t.newGrossProfit;
        return { ...t, newMultiplier: newMult, newGrossProfit: parseFloat(newGP.toFixed(1)) };
      })
    }));
  };

  // Reset all manual edits
  const resetAllEdits = () => {
    isResettingRef.current = true; // Suppress onBlur firing during reset (Bug 10)
    setLockedTiers({});
    setOriginalTargetProfit(null); // Clear stored target to recalculate fresh
    // Pass empty locks AND null target directly to avoid stale state (Bug 1)
    calculateRecommendations({}, null);
    // Clear resetting flag after microtask (allows React to process)
    setTimeout(() => { isResettingRef.current = false; }, 0);
  };

  // Chart colors
  const COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

  // Export as CSV
  const exportCSV = () => {
    if (IS_TRIAL_MODE) {
      alert("🔒 DEMO MODE ACTIVE\n\nPlease contact the developer to unlock the full Export functionality.");
      return;
    }

    if (!recommendations) return;

    const headers = ['Min Cost', 'Max Cost', 'Current Multiplier', 'New Multiplier', 'Current GP%', 'New GP%', 'Change'];
    const rows = recommendations.tiers.map(tier => [
      tier.minCost.toFixed(2),
      tier.maxCost === 999999 ? 'Maximum' : tier.maxCost.toFixed(2),
      tier.multiplier.toFixed(2),
      tier.newMultiplier.toFixed(2),
      tier.grossProfit.toFixed(1),
      tier.newGrossProfit.toFixed(1),
      tier.multiplierChange > 0 ? `+${tier.multiplierChange.toFixed(2)}` : tier.multiplierChange.toFixed(2)
    ]);
    
    const csvContent = [
      '# Price Matrix Optimization Report',
      `# Generated: ${new Date().toLocaleDateString()}`,
      `# Current Profit: ${formatCurrency(recommendations.currentProfit)}`,
      `# Projected Profit: ${formatCurrency(recommendations.projectedProfit)}`,
      `# Increase: ${formatPercent(recommendations.percentIncrease)}`,
      '',
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `price-matrix-optimized-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export as formatted text report (for printing/PDF)
  const exportReport = () => {
    if (IS_TRIAL_MODE) {
      alert("🔒 DEMO MODE ACTIVE\n\nPlease contact the developer to unlock the full Export functionality.");
      return;
    }

    if (!recommendations) return;

    const report = `
════════════════════════════════════════════════════════════════
                    PRICE MATRIX OPTIMIZATION REPORT
════════════════════════════════════════════════════════════════

Generated: ${new Date().toLocaleString()}
Data Source: ${fileName || 'Uploaded CSV'}
Parts Analyzed: ${partsData.length}

────────────────────────────────────────────────────────────────
                         FINANCIAL SUMMARY
────────────────────────────────────────────────────────────────

  Current Profit:     ${formatCurrency(recommendations.currentProfit).padStart(12)}
  Target Profit:      ${formatCurrency(recommendations.targetProfit).padStart(12)}
  Projected Profit:   ${formatCurrency(recommendations.projectedProfit).padStart(12)}
  ─────────────────────────────────────
  Profit Increase:    ${formatCurrency(recommendations.profitIncrease).padStart(12)}  (+${formatPercent(recommendations.percentIncrease)})

────────────────────────────────────────────────────────────────
                    RECOMMENDED MATRIX CHANGES
────────────────────────────────────────────────────────────────

${recommendations.tiers.map(tier => `
  Cost Range: $${tier.minCost.toFixed(2)} - ${tier.maxCost === 999999 ? 'Maximum' : '$' + tier.maxCost.toFixed(2)}
  ├─ Current:     ${tier.multiplier.toFixed(2)}x  (${tier.grossProfit.toFixed(1)}% GP)
  ├─ Recommended: ${tier.newMultiplier.toFixed(2)}x  (${tier.newGrossProfit.toFixed(1)}% GP)
  ├─ Change:      ${tier.multiplierChange > 0 ? '+' : ''}${tier.multiplierChange.toFixed(2)}x
  └─ Parts in tier: ${tier.partCount} (${tier.revenueShare.toFixed(1)}% of revenue)
`).join('')}
────────────────────────────────────────────────────────────────
                      QUICK REFERENCE TABLE
────────────────────────────────────────────────────────────────

  COST RANGE              MULTIPLIER    GROSS PROFIT %
  ─────────────────────────────────────────────────────
${recommendations.tiers.map(tier => 
  `  $${tier.minCost.toFixed(2).padEnd(8)} - ${(tier.maxCost === 999999 ? 'Max' : '$' + tier.maxCost.toFixed(2)).padEnd(10)}    ${tier.newMultiplier.toFixed(2)}x          ${tier.newGrossProfit.toFixed(1)}%`
).join('\n')}

════════════════════════════════════════════════════════════════
  Copy the values above directly into your POS price matrix.
════════════════════════════════════════════════════════════════
`;

    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `price-matrix-report-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Copy to clipboard function
  const copyToClipboard = () => {
    if (IS_TRIAL_MODE) {
      alert("🔒 DEMO MODE ACTIVE\n\nPlease contact the developer to unlock the Copy functionality.");
      return;
    }

    if (!recommendations) return;

    const tableText = recommendations.tiers.map(tier =>
      `$${tier.minCost.toFixed(2)}-${tier.maxCost === 999999 ? 'Max' : '$' + tier.maxCost.toFixed(2)}\t${tier.newMultiplier.toFixed(2)}\t${tier.newGrossProfit.toFixed(1)}%`
    ).join('\n');

    const header = 'Cost Range\tMultiplier\tGross Profit %\n';
    navigator.clipboard.writeText(header + tableText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 font-sans">
      {/* Header - Minimal & Professional */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                Price Matrix Optimizer
              </h1>
              <p className="text-slate-500 text-xs mt-0.5">Intelligent pricing for auto parts</p>
            </div>
          </div>

          {/* Trial Mode Badge */}
          {IS_TRIAL_MODE && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"></div>
              <span className="text-amber-400 text-xs font-medium">Demo Mode</span>
            </div>
          )}
        </div>

        {/* Progress Steps - Minimal Design */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {['Matrix Setup', 'Upload Data', 'Set Target', 'Results'].map((label, idx) => (
            <div key={idx} className="flex items-center flex-shrink-0">
              <button
                onClick={() => idx < step && setStep(idx + 1)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  step === idx + 1
                    ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                    : step > idx + 1
                    ? 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 cursor-pointer'
                    : 'bg-transparent text-slate-600 cursor-not-allowed'
                }`}
              >
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step > idx + 1 ? 'bg-emerald-500 text-slate-950' : step === idx + 1 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-600'
                }`}>
                  {step > idx + 1 ? '✓' : idx + 1}
                </span>
                <span className="whitespace-nowrap">{label}</span>
              </button>
              {idx < 3 && (
                <div className={`w-6 h-[2px] mx-1 ${step > idx + 1 ? 'bg-emerald-500' : 'bg-slate-800'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto">
        {/* Step 1: Matrix Setup */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Your Price Matrix</h2>
                  <p className="text-slate-500 text-xs mt-1">
                    Auto-saved to browser
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (window.confirm('Reset matrix to default values? This cannot be undone.')) {
                        setMatrix(defaultMatrix);
                      }
                    }}
                    className="px-3 py-2 bg-slate-800 text-slate-400 rounded-lg hover:bg-slate-700 hover:text-slate-300 transition-colors text-sm"
                  >
                    Reset
                  </button>
                  <button
                    onClick={addTier}
                    disabled={matrix.length >= 10}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>+</span> Add Tier
                  </button>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-slate-400 text-sm">
                      <th className="text-left pb-3 px-2">Cost Range</th>
                      <th className="text-center pb-3 px-2">Multiplier</th>
                      <th className="text-center pb-3 px-2">Gross Profit %</th>
                      <th className="text-center pb-3 px-2">Markup %</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((tier) => (
                      <tr key={tier.id} className="border-t border-slate-800">
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={tier.minCost}
                              onChange={(e) => updateTier(tier.id, 'minCost', e.target.value)}
                              className="w-24 bg-slate-800 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                              step="0.01"
                            />
                            <span className="text-slate-500">to</span>
                            <input
                              type="number"
                              value={tier.maxCost === 999999 ? '' : tier.maxCost}
                              placeholder="Max"
                              onChange={(e) => updateTier(tier.id, 'maxCost', e.target.value || 999999)}
                              onBlur={() => handleMaxCostBlur(tier.id)}
                              className="w-24 bg-slate-800 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                              step="0.01"
                            />
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          {/* Bug 19: Use defaultValue + onBlur to prevent decimal typing frustration */}
                          <input
                            type="number"
                            key={`mult-${tier.id}-${tier.grossProfit}`}
                            defaultValue={tier.multiplier}
                            onBlur={(e) => updateTier(tier.id, 'multiplier', e.target.value)}
                            className="w-20 bg-slate-800 rounded-lg px-3 py-2 text-white text-center focus:ring-2 focus:ring-emerald-500 outline-none"
                            step="0.01"
                            min="1.01"
                            max="100"
                          />
                        </td>
                        <td className="py-3 px-2">
                          <div className="flex items-center justify-center gap-1">
                            {/* Bug 19: Use defaultValue + onBlur to prevent decimal typing frustration */}
                            <input
                              type="number"
                              key={`gp-${tier.id}-${tier.multiplier}`}
                              defaultValue={Math.round(tier.grossProfit * 10) / 10}
                              onBlur={(e) => updateTier(tier.id, 'grossProfit', e.target.value)}
                              className="w-20 bg-slate-800 rounded-lg px-3 py-2 text-white text-center focus:ring-2 focus:ring-emerald-500 outline-none"
                              step="0.1"
                              min="0"
                              max="99.9"
                            />
                            <span className="text-slate-500">%</span>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-center">
                          <span className="text-cyan-400 font-medium">
                            {((tier.multiplier - 1) * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-3 px-2">
                          <button
                            onClick={() => removeTier(tier.id)}
                            disabled={matrix.length <= 2}
                            className="p-2 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-30"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Bug 17: Warning banner for cost range gaps/overlaps */}
              {rangeIssues.length > 0 && (
                <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                  <div className="text-amber-400 text-sm font-semibold mb-1">⚠️ Cost Range Issues Detected</div>
                  {rangeIssues.map((issue, i) => (
                    <div key={i} className="text-amber-300 text-xs mt-1">
                      {issue.type === 'gap' 
                        ? `Gap between Tier ${issue.from} and Tier ${issue.to}: ${issue.range} — parts in this range won't be categorized`
                        : `Overlap between Tier ${issue.from} and Tier ${issue.to}: ${issue.range} — parts may be double-counted`
                      }
                    </div>
                  ))}
                  <div className="text-slate-400 text-xs mt-2">Tip: Edit the Max Cost of a tier — the next tier's Min Cost will auto-adjust on blur.</div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                <div className="bg-slate-800 rounded-xl p-4">
                  <div className="text-slate-400 text-sm">Tier Count</div>
                  <div className="text-2xl font-bold text-white mt-1">{matrixSummary.tierCount}</div>
                </div>
                <div className="bg-slate-800 rounded-xl p-4">
                  <div className="text-slate-400 text-sm">Average Multiplier</div>
                  <div className="text-2xl font-bold text-cyan-400 mt-1">{matrixSummary.averageMultiplier.toFixed(2)}x</div>
                </div>
                <div className="bg-slate-800 rounded-xl p-4">
                  <div className="text-slate-400 text-sm">Average Gross Profit</div>
                  <div className="text-2xl font-bold text-emerald-400 mt-1">{matrixSummary.averageGrossProfit.toFixed(1)}%</div>
                </div>
                <div className="bg-slate-800 rounded-xl p-4">
                  <div className="text-slate-400 text-sm">Top Open Range</div>
                  <div className="text-lg font-bold text-white mt-1">
                    {matrixSummary.hasOpenEndedTier && matrixSummary.highestOpenRangeStart !== null
                      ? `${formatCurrency(matrixSummary.highestOpenRangeStart)}+`
                      : 'Missing'}
                  </div>
                </div>
              </div>

              <p className="text-slate-500 text-sm mt-4">
                Tip: Edit the Gross Profit % and the Multiplier will auto-calculate, or vice versa. Your matrix is automatically saved and will persist even if you close the browser.
              </p>
            </div>
            
            <button
              onClick={() => setStep(2)}
              className="w-full py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-semibold rounded-xl hover:opacity-90 transition-opacity"
            >
              Continue to Upload Data →
            </button>
          </div>
        )}

        {/* Step 2: Upload Data */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-2xl p-8 border border-slate-800">
              <div className="text-center">
                <h2 className="text-base font-semibold text-white mb-2">Upload Parts Sales Data</h2>
                <p className="text-slate-400 text-sm mb-6 max-w-md mx-auto">
                  Upload a CSV file with your parts sales data. Must include a "Unit Cost" column.
                  <span className="block text-slate-500 text-xs mt-1">Supports formatted values like $1,234.56</span>
                </p>
                
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <label className="inline-block">
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <span className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500/20 text-emerald-400 rounded-xl hover:bg-emerald-500/30 transition-colors cursor-pointer font-medium">
                      Choose CSV File
                    </span>
                  </label>

                  <a
                    href="/sample-parts-data.csv"
                    download
                    className="inline-flex items-center gap-2 px-5 py-3 bg-slate-800 text-slate-200 rounded-xl hover:bg-slate-700 transition-colors text-sm font-medium"
                  >
                    Download Sample CSV
                  </a>
                </div>
                
                <p className="mt-3 text-slate-500 text-xs">
                  No export handy? Start with the sample file and see the flow before using live shop data.
                </p>

                {fileName && (
                  <div className="mt-4 text-center text-emerald-400">
                    <span>{fileName}</span>
                    <span className="text-slate-500 ml-2">({partsData.length} parts loaded)</span>
                  </div>
                )}

                {/* Add this Warning Block */}
                {skippedCount > 0 && (
                  <div className="mt-2 text-amber-400 text-sm bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20 text-center">
                    <span>Warning: {skippedCount} rows were skipped due to formatting errors.</span>
                  </div>
                )}
                
                {error && (
                  <div className="mt-4 p-4 bg-red-500/20 text-red-400 rounded-xl">
                    {error}
                  </div>
                )}
              </div>
            </div>
            
            {/* Tier Analysis Preview */}
            {tierAnalysis.length > 0 && tierAnalysis.some(t => t.partCount > 0) && (
              <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
                <h3 className="text-lg font-semibold text-white mb-4">Parts Distribution by Tier</h3>
                <div className="h-64">
                  <Suspense fallback={<div className="h-full rounded-xl bg-slate-800/60 animate-pulse" />}>
                    <LazyChartSection
                      variant="distribution"
                      data={tierAnalysis.filter((tier) => tier.partCount > 0)}
                      colors={COLORS}
                    />
                  </Suspense>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
                  <div className="bg-slate-800 rounded-xl p-4">
                    <div className="text-slate-400 text-sm">Total Parts</div>
                    <div className="text-2xl font-bold text-white">{partsData.length}</div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-4">
                    <div className="text-slate-400 text-sm">Total Cost</div>
                    <div className="text-2xl font-bold text-white">
                      {formatCurrency(tierAnalysis.reduce((sum, t) => sum + t.totalCost, 0))}
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-4">
                    <div className="text-slate-400 text-sm">Total Revenue</div>
                    <div className="text-2xl font-bold text-white">
                      {formatCurrency(tierAnalysis.reduce((sum, t) => sum + t.totalRetail, 0))}
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-4">
                    <div className="text-slate-400 text-sm">Current Profit</div>
                    <div className="text-2xl font-bold text-emerald-400">
                      {formatCurrency(tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0))}
                    </div>
                  </div>
                  {/* REQUEST #1: Current Profit Margin % */}
                  <div className="bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 rounded-xl p-4 border border-emerald-500/30">
                    <div className="text-emerald-400 text-sm font-semibold">Current Margin %</div>
                    <div className="text-2xl font-bold text-white">
                      {(() => {
                        const profit = tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0);
                        const revenue = tierAnalysis.reduce((sum, t) => sum + t.totalRetail, 0);
                        const margin = revenue > 0 ? (profit / revenue * 100) : 0;
                        return `${margin.toFixed(1)}%`;
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex gap-4">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-4 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={partsData.length === 0}
                className="flex-1 py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Set Target →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Set Target */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
              <h2 className="text-lg font-semibold text-white mb-6">Set Your Margin Target</h2>
              
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-slate-400 text-sm mb-2">Target Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setTargetType('percent')}
                      className={`py-3 px-3 rounded-xl font-medium transition-all text-sm ${
                        targetType === 'percent'
                          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      % Growth
                    </button>
                    <button
                      onClick={() => setTargetType('margin')}
                      className={`py-3 px-3 rounded-xl font-medium transition-all text-sm ${
                        targetType === 'margin'
                          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      Target Margin
                    </button>
                    <button
                      onClick={() => setTargetType('dollar')}
                      className={`py-3 px-3 rounded-xl font-medium transition-all text-sm ${
                        targetType === 'dollar'
                          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      $ Amount
                    </button>
                  </div>
                </div>
                
                <div>
                  <label className="block text-slate-400 text-sm mb-2">
                    {targetType === 'percent' ? 'Profit Increase %' : targetType === 'margin' ? 'Target Margin %' : 'Additional Profit $'}
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
                      {targetType === 'dollar' ? '$' : ''}
                    </span>
                    <input
                      type="number"
                      value={targetIncrease}
                      onChange={(e) => setTargetIncrease(parseFloat(e.target.value) || 0)}
                      className={`w-full bg-slate-800 rounded-xl py-3 text-white text-xl font-bold focus:ring-2 focus:ring-emerald-500 outline-none ${
                        targetType === 'dollar' ? 'pl-8 pr-4' : 'px-4'
                      }`}
                    />
                    {(targetType === 'percent' || targetType === 'margin') && (
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500">%</span>
                    )}
                  </div>

                  {/* Helpful descriptions */}
                  <p className="text-slate-500 text-xs mt-2">
                    {targetType === 'percent' && 'Increase your total profit by this percentage (e.g., 10% means 10% more profit)'}
                    {targetType === 'margin' && 'Set your target profit margin to exactly this percentage (must be HIGHER than current margin)'}
                    {targetType === 'dollar' && 'Increase your total profit by this dollar amount'}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {targetPresets[targetType].map((preset) => (
                      <button
                        key={`${targetType}-${preset}`}
                        onClick={() => setTargetIncrease(preset)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          targetIncrease === preset
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {targetType === 'dollar' ? `$${preset.toLocaleString()}` : `${preset}%`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="mt-6 p-4 bg-slate-800 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Current Profit:</span>
                  <span className="text-white font-semibold">
                    {formatCurrency(tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-slate-400 text-sm">Current Margin:</span>
                  <span className="text-cyan-400 font-semibold text-sm">
                    {(() => {
                      const currentProfit = tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0);
                      const currentRevenue = tierAnalysis.reduce((sum, t) => sum + t.totalRetail, 0);
                      const currentMargin = currentRevenue > 0 ? (currentProfit / currentRevenue * 100) : 0;
                      return `${currentMargin.toFixed(1)}%`;
                    })()}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-slate-400">Target Profit:</span>
                  <span className="text-emerald-400 font-semibold">
                    {formatCurrency(
                      (() => {
                        const currentProfit = tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0);
                        const currentCost = tierAnalysis.reduce((sum, t) => sum + t.totalCost, 0);
                        if (targetType === 'percent') {
                          return currentProfit * (1 + targetIncrease / 100);
                        } else if (targetType === 'margin') {
                          const targetMarginDecimal = targetIncrease / 100;
                          const targetRevenue = currentCost / (1 - targetMarginDecimal);
                          return targetRevenue - currentCost;
                        } else {
                          return currentProfit + targetIncrease;
                        }
                      })()
                    )}
                  </span>
                </div>
              </div>

              {/* Warning: Target Margin Lower Than Current */}
              {targetType === 'margin' && (() => {
                const currentProfit = tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0);
                const currentRevenue = tierAnalysis.reduce((sum, t) => sum + t.totalRetail, 0);
                const currentMargin = currentRevenue > 0 ? (currentProfit / currentRevenue * 100) : 0;
                return targetIncrease < currentMargin ? (
                  <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                    <div className="flex items-start gap-3">
                      <div className="text-amber-400 text-sm leading-relaxed">
                        <strong className="block mb-1">⚠️ Warning: Target Margin Lower Than Current</strong>
                        <p>Your current margin is <strong>{currentMargin.toFixed(1)}%</strong> but you're targeting <strong>{targetIncrease}%</strong>.</p>
                        <p className="mt-2">This would require DECREASING prices, which the optimizer will not do. The result will show no changes.</p>
                        <p className="mt-2"><strong>Did you mean:</strong> Use "% Growth" to increase profit by {targetIncrease}%?</p>
                      </div>
                    </div>
                  </div>
                ) : null;
              })()}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-4 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => {
                  setLockedTiers({}); // Start fresh with no manual overrides
                  setOriginalTargetProfit(null); // Clear stored target for fresh calculation
                  calculateRecommendations({}, null); // Pass overrides to avoid stale state
                }}
                disabled={isAnalyzing}
                className="flex-1 py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isAnalyzing ? 'Analyzing...' : 'Generate Recommendations →'}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Results */}
        {step === 4 && recommendations && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
                <div className="text-slate-400 text-sm">Current Profit</div>
                <div className="text-2xl font-bold text-white mt-1">
                  {formatCurrency(recommendations.currentProfit)}
                </div>
              </div>
              <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
                <div className="text-slate-400 text-sm">Target Profit</div>
                <div className="text-2xl font-bold text-cyan-400 mt-1">
                  {formatCurrency(recommendations.targetProfit)}
                </div>
              </div>
              <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
                <div className="text-slate-400 text-sm">Projected Profit</div>
                <div className="text-2xl font-bold text-emerald-400 mt-1">
                  {formatCurrency(recommendations.projectedProfit)}
                </div>
              </div>
              <div className="bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 rounded-2xl p-5 border border-emerald-500/30">
                <div className="text-emerald-300 text-sm">Profit Increase</div>
                <div className="text-2xl font-bold text-emerald-400 mt-1">
                  +{formatPercent(recommendations.percentIncrease)}
                </div>
              </div>
            </div>

            {/* Recommended Matrix */}
            <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Recommended Matrix Adjustments</h2>
                  <p className="text-xs text-slate-500 mt-1">💡 Click any "New Mult." value to edit it manually</p>
                </div>
                <div className="flex gap-2">
                  {Object.keys(lockedTiers).length > 0 && (
                    <button
                      onClick={resetAllEdits}
                      className="px-3 py-2 bg-amber-500/20 text-amber-400 text-sm rounded-lg hover:bg-amber-500/30 transition-colors border border-amber-500/30"
                    >
                      Reset Edits ({Object.keys(lockedTiers).length})
                    </button>
                  )}
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors text-sm"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-slate-400 text-sm border-b border-slate-800">
                      <th className="text-left pb-3 px-2">Cost Range</th>
                      <th className="text-center pb-3 px-2">Current Mult.</th>
                      <th className="text-center pb-3 px-2">New Mult.</th>
                      <th className="text-center pb-3 px-2">Change</th>
                      <th className="text-center pb-3 px-2">Current GP%</th>
                      <th className="text-center pb-3 px-2">New GP%</th>
                      <th className="text-center pb-3 px-2">Parts</th>
                      <th className="text-center pb-3 px-2">Revenue Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendations.tiers.map((tier, idx) => (
                      <tr key={tier.id} className="border-t border-slate-800">
                        <td className="py-3 px-2">
                          <span className="inline-flex items-center gap-2">
                            <span 
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                            />
                            ${tier.minCost.toFixed(2)} - {tier.maxCost === 999999 ? 'Max' : `$${tier.maxCost.toFixed(2)}`}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-center text-slate-400">
                          {tier.multiplier.toFixed(2)}x
                        </td>
                        {/* REQUEST #2: EDITABLE New Multiplier with Auto-Redistribution */}
                        {/* Bug 19: Use defaultValue + onBlur to prevent decimal typing frustration */}
                        <td className="py-3 px-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              key={`${tier.id}-${tier.isLocked ? 'locked' : 'auto'}-${tier.newMultiplier}`}
                              type="number"
                              step="0.01"
                              min="1.01"
                              max="20"
                              defaultValue={tier.newMultiplier}
                              onBlur={(e) => handleManualTierChange(tier.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.target.blur();
                                }
                              }}
                              className={`w-16 px-2 py-1 text-center font-bold rounded transition-all ${
                                tier.isLocked
                                  ? 'bg-amber-900/30 text-amber-400 border-2 border-amber-500/50 ring-2 ring-amber-500/20'
                                  : 'bg-slate-800 text-emerald-400 border border-slate-700 focus:ring-2 focus:ring-emerald-500 hover:border-emerald-500/50'
                              } outline-none`}
                              title={tier.isLocked ? '🔒 Locked - Other tiers will adjust' : 'Click to edit'}
                            />
                            <span className="text-slate-500">×</span>
                            {tier.isLocked && (
                              <span className="text-amber-500 text-xs ml-1">🔒</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-2 text-center">
                          {tier.multiplierChange > 0 ? (
                            <span className="text-emerald-400">+{tier.multiplierChange.toFixed(2)}</span>
                          ) : tier.multiplierChange < 0 ? (
                            <span className="text-red-400">{tier.multiplierChange.toFixed(2)}</span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-center text-slate-400">
                          {tier.grossProfit.toFixed(1)}%
                        </td>
                        <td className="py-3 px-2 text-center font-semibold text-white">
                          {tier.newGrossProfit.toFixed(1)}%
                        </td>
                        <td className="py-3 px-2 text-center text-slate-400">
                          {tier.partCount}
                        </td>
                        <td className="py-3 px-2 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 bg-slate-800 rounded-full h-2 overflow-hidden">
                              <div 
                                className="h-full rounded-full"
                                style={{ 
                                  width: `${tier.revenueShare}%`,
                                  backgroundColor: COLORS[idx % COLORS.length]
                                }}
                              />
                            </div>
                            <span className="text-slate-400 text-sm">{tier.revenueShare.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Visual Comparison */}
            <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
              <h3 className="text-lg font-semibold text-white mb-4">Multiplier Comparison</h3>
              <div className="h-64">
                <Suspense fallback={<div className="h-full rounded-xl bg-slate-800/60 animate-pulse" />}>
                  <LazyChartSection
                    variant="comparison"
                    data={recommendations.tiers.filter((tier) => tier.partCount > 0)}
                  />
                </Suspense>
              </div>
            </div>

            {/* Strategy Explanation */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 border border-slate-700">
              <h3 className="text-lg font-semibold text-white mb-3">
                Optimization Strategy
              </h3>
              <p className="text-slate-300 leading-relaxed">
                These recommendations are weighted based on two factors: <strong className="text-emerald-400">sales volume</strong> (tiers
                with more sales get larger adjustments since they have bigger impact) and <strong className="text-cyan-400">headroom</strong> (tiers
                with lower current margins can be increased more without hitting price sensitivity). Adjustments are capped at 50%
                per tier to minimize price shock on any individual part.
              </p>
            </div>

            {/* Export Section */}
            <div className="bg-emerald-500/10 rounded-2xl p-5 border border-emerald-500/30">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-white">Export Your New Matrix</h3>
                <p className="text-slate-400 text-xs mt-1">Download to update your POS system</p>
              </div>
              
              <div className="grid sm:grid-cols-3 gap-2">
                <button
                  onClick={exportCSV}
                  className="px-3 py-2.5 bg-emerald-500 text-slate-950 text-sm font-medium rounded-lg hover:bg-emerald-400 transition-colors"
                >
                  CSV
                </button>

                <button
                  onClick={exportReport}
                  className="px-3 py-2.5 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-600 transition-colors"
                >
                  Report
                </button>

                <button
                  onClick={copyToClipboard}
                  className="px-3 py-2.5 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-600 transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              
              <p className="text-slate-500 text-xs mt-3">
                CSV format works with most shop management systems including Tekmetric, Shop-Ware, and Mitchell.
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep(3)}
                className="px-6 py-4 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors"
              >
                ← Adjust Target
              </button>
              <button
                onClick={() => {
                  setStep(1);
                  setRecommendations(null);
                  setPartsData([]);
                  setTierAnalysis([]);
                  setLockedTiers({}); // Clear manual edits
                  setOriginalTargetProfit(null); // Clear stored target
                }}
                className="flex-1 py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-semibold rounded-xl hover:opacity-90 transition-opacity"
              >
                Start New Analysis
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="max-w-6xl mx-auto mt-12 text-center text-slate-600 text-sm">
        Price Matrix Optimizer • All calculations performed locally in your browser
      </div>
    </div>
  );
}
