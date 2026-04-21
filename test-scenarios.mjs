/**
 * Real-world test scenarios for the Price Matrix Optimizer algorithm
 * Tests the core optimization logic outside of React
 */

// ── Default Matrix ──
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

// ── Real auto parts data ──
const realParts = [
  // Cheap parts (Tier 1-2)
  { unitCost: 0.89, unitRetail: 4.99, qty: 150 },   // Drain plugs
  { unitCost: 1.20, unitRetail: 5.99, qty: 80 },    // Gaskets
  { unitCost: 3.50, unitRetail: 14.99, qty: 200 },  // Oil filters
  { unitCost: 4.25, unitRetail: 18.99, qty: 120 },  // Air filters
  { unitCost: 2.10, unitRetail: 9.99, qty: 90 },    // Spark plugs
  { unitCost: 5.50, unitRetail: 24.99, qty: 60 },   // Fuel filters

  // Mid parts (Tier 3-4)
  { unitCost: 7.80, unitRetail: 29.99, qty: 45 },   // Wiper blades
  { unitCost: 8.50, unitRetail: 34.99, qty: 35 },   // Belts
  { unitCost: 12.00, unitRetail: 44.99, qty: 80 },  // Thermostats
  { unitCost: 18.50, unitRetail: 64.99, qty: 50 },  // Water pumps
  { unitCost: 25.00, unitRetail: 79.99, qty: 40 },  // Brake pads (front)
  { unitCost: 28.00, unitRetail: 89.99, qty: 35 },  // Brake pads (rear)

  // Higher parts (Tier 5-6)
  { unitCost: 35.00, unitRetail: 99.99, qty: 30 },  // Rotors (each)
  { unitCost: 42.00, unitRetail: 119.99, qty: 25 }, // Calipers
  { unitCost: 55.00, unitRetail: 149.99, qty: 20 }, // Starters
  { unitCost: 85.00, unitRetail: 229.99, qty: 15 }, // Alternators
  { unitCost: 120.00, unitRetail: 299.99, qty: 10 }, // Radiators

  // Expensive parts (Tier 7-8)
  { unitCost: 175.00, unitRetail: 449.99, qty: 8 },  // AC compressors
  { unitCost: 220.00, unitRetail: 549.99, qty: 5 },  // Transmissions (reman)
  { unitCost: 350.00, unitRetail: 749.99, qty: 3 },  // Engines (reman)
  { unitCost: 450.00, unitRetail: 899.99, qty: 2 },  // Catalytic converters
];

// Compute parts with totals
const parts = realParts.map(p => ({
  ...p,
  totalCost: p.unitCost * p.qty,
  totalRetail: p.unitRetail * p.qty,
}));

// ── Analyze tiers ──
function analyzeTiers(matrix, parts) {
  const assignedIndices = new Set();
  const analysis = matrix.map(tier => {
    const tierParts = [];
    parts.forEach((p, idx) => {
      if (!assignedIndices.has(idx) && p.unitCost >= tier.minCost && p.unitCost <= tier.maxCost) {
        tierParts.push(p);
        assignedIndices.add(idx);
      }
    });
    const totalCost = tierParts.reduce((sum, p) => sum + p.totalCost, 0);
    const totalRetail = tierParts.reduce((sum, p) => sum + p.totalRetail, 0);
    const totalQty = tierParts.reduce((sum, p) => sum + p.qty, 0);
    const currentProfit = totalRetail - totalCost;
    return { ...tier, partCount: tierParts.length, totalQty, totalCost, totalRetail, currentProfit, revenueShare: 0 };
  });
  const totalRevenue = analysis.reduce((sum, t) => sum + t.totalRetail, 0);
  analysis.forEach(t => { t.revenueShare = totalRevenue > 0 ? (t.totalRetail / totalRevenue) * 100 : 0; });
  return analysis;
}

// ── Optimize ──
function optimize(tierAnalysis, targetPercent, lockedTiers = {}) {
  const currentTotalProfit = tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0);
  const currentTotalRevenue = tierAnalysis.reduce((sum, t) => sum + t.totalRetail, 0);
  const currentTotalCost = tierAnalysis.reduce((sum, t) => sum + t.totalCost, 0);
  const targetProfit = currentTotalProfit * (1 + targetPercent / 100);

  const currentActualOverallMult = currentTotalCost > 0 ? currentTotalRevenue / currentTotalCost : 1;
  const targetOverallMult = currentTotalCost > 0 ? (1 + targetProfit / currentTotalCost) : 1;
  const ratio = targetOverallMult / currentActualOverallMult;

  let optimized = tierAnalysis.map(tier => {
    if (tier.totalCost <= 0 || tier.totalRetail <= 0) {
      return { ...tier, newMultiplier: tier.multiplier, projectedProfit: 0, isLocked: false, currentActualMultiplier: tier.multiplier };
    }
    const currentActualMult = tier.totalRetail / tier.totalCost;

    if (lockedTiers[tier.id]) {
      const locked = lockedTiers[tier.id];
      const projActual = tier.multiplier > 0 ? currentActualMult * (locked / tier.multiplier) : locked;
      return { ...tier, currentActualMultiplier: currentActualMult, newMultiplier: locked, projectedProfit: tier.totalCost * projActual - tier.totalCost, isLocked: true };
    }

    const volWeight = tier.revenueShare / 100;
    const headroom = 1 - ((tier.totalRetail - tier.totalCost) / tier.totalRetail);
    const combined = volWeight * 0.6 + headroom * 0.4;
    const weighted = (ratio - 1) * (0.5 + combined);
    let newMult = tier.multiplier * (1 + weighted);
    newMult = Math.max(newMult, tier.multiplier);
    newMult = Math.min(newMult, tier.multiplier * 1.5);
    let gp = 100 - (100 / newMult);
    if (gp > 95) { gp = 95; newMult = 20.0; }
    const projActual = tier.multiplier > 0 ? currentActualMult * (newMult / tier.multiplier) : newMult;
    return { ...tier, currentActualMultiplier: currentActualMult, newMultiplier: parseFloat(newMult.toFixed(2)), projectedProfit: tier.totalCost * projActual - tier.totalCost, isLocked: false };
  });

  // Target enforcer
  let projTotal = optimized.reduce((sum, t) => sum + t.projectedProfit, 0);
  let attempts = 0;
  const tolerance = Math.max(targetProfit * 0.005, 0.01);
  while (Math.abs(projTotal - targetProfit) > tolerance && attempts < 50) {
    const gap = targetProfit - projTotal;
    const isUnder = gap > 0;
    const adjustable = optimized.filter(t => !t.isLocked && t.totalCost > 0).length;
    if (adjustable === 0) break;
    const gapPct = Math.abs(gap / targetProfit);
    const step = gapPct > 0.05 ? 0.015 : 0.005;

    optimized = optimized.map(tier => {
      if (tier.totalCost <= 0 || tier.isLocked) return tier;
      if (isUnder && (tier.newMultiplier >= tier.multiplier * 1.5 || (100 - 100 / tier.newMultiplier) >= 95)) return tier;
      if (!isUnder && tier.newMultiplier <= tier.multiplier) return tier;
      let nudge = isUnder ? tier.newMultiplier * (1 + step) : tier.newMultiplier * (1 - step);
      nudge = Math.max(nudge, tier.multiplier);
      nudge = Math.min(nudge, tier.multiplier * 1.5);
      let gp = 100 - (100 / nudge);
      if (gp > 95) { nudge = 20.0; }
      const projActual = tier.multiplier > 0 ? tier.currentActualMultiplier * (nudge / tier.multiplier) : nudge;
      return { ...tier, newMultiplier: parseFloat(nudge.toFixed(2)), projectedProfit: tier.totalCost * projActual - tier.totalCost };
    });
    projTotal = optimized.reduce((sum, t) => sum + t.projectedProfit, 0);
    attempts++;
  }

  return { targetProfit, projectedProfit: projTotal, tiers: optimized, iterations: attempts };
}

// ══════════════════════════════════════════
//  TEST SCENARIOS
// ══════════════════════════════════════════

const fmt = (v) => `$${v.toFixed(2)}`;
const pct = (v) => `${v.toFixed(1)}%`;
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ── Scenario 1: Basic analysis ──
console.log('\n📊 SCENARIO 1: Basic tier analysis with 21 real parts');
const analysis = analyzeTiers(defaultMatrix, parts);
const totalParts = analysis.reduce((s, t) => s + t.partCount, 0);
const totalCost = analysis.reduce((s, t) => s + t.totalCost, 0);
const totalRevenue = analysis.reduce((s, t) => s + t.totalRetail, 0);
const totalProfit = totalRevenue - totalCost;
const margin = (totalProfit / totalRevenue * 100);

console.log(`  Parts: ${totalParts} | Cost: ${fmt(totalCost)} | Revenue: ${fmt(totalRevenue)} | Profit: ${fmt(totalProfit)} | Margin: ${pct(margin)}`);
analysis.filter(t => t.partCount > 0).forEach(t => {
  console.log(`  Tier ${t.id} ($${t.minCost}-${t.maxCost === 999999 ? 'Max' : '$'+t.maxCost}): ${t.partCount} parts, Cost: ${fmt(t.totalCost)}, Revenue: ${fmt(t.totalRetail)}, Share: ${pct(t.revenueShare)}`);
});

test('All 21 parts assigned to tiers', () => assert(totalParts === 21, `Got ${totalParts}`));
test('Profit is positive', () => assert(totalProfit > 0, `Profit: ${fmt(totalProfit)}`));
test('Margin between 40-80%', () => assert(margin > 40 && margin < 80, `Margin: ${pct(margin)}`));

// ── Scenario 2: 5% profit increase ──
console.log('\n📊 SCENARIO 2: 5% profit increase optimization');
const opt5 = optimize(analysis, 5);
console.log(`  Target: ${fmt(opt5.targetProfit)} | Projected: ${fmt(opt5.projectedProfit)} | Iterations: ${opt5.iterations}`);
opt5.tiers.filter(t => t.partCount > 0).forEach(t => {
  console.log(`  Tier ${t.id}: ${t.multiplier.toFixed(2)}x → ${t.newMultiplier.toFixed(2)}x (${t.newMultiplier > t.multiplier ? '+' : ''}${(t.newMultiplier - t.multiplier).toFixed(2)})`);
});

const gap5 = Math.abs(opt5.projectedProfit - opt5.targetProfit) / opt5.targetProfit * 100;
test('Projected within 0.5% of target', () => assert(gap5 < 0.5, `Gap: ${pct(gap5)}`));
test('No multiplier decreased', () => assert(opt5.tiers.every(t => t.newMultiplier >= t.multiplier), 'Some multiplier decreased'));
test('No multiplier exceeds 1.5x original', () => assert(opt5.tiers.every(t => t.newMultiplier <= t.multiplier * 1.501), 'Exceeded 1.5x cap'));

// ── Scenario 3: 20% profit increase ──
console.log('\n📊 SCENARIO 3: 20% profit increase (aggressive)');
const opt20 = optimize(analysis, 20);
console.log(`  Target: ${fmt(opt20.targetProfit)} | Projected: ${fmt(opt20.projectedProfit)} | Iterations: ${opt20.iterations}`);
const gap20 = Math.abs(opt20.projectedProfit - opt20.targetProfit) / opt20.targetProfit * 100;
test('Projected within 1% of target', () => assert(gap20 < 1, `Gap: ${pct(gap20)}`));
test('All multipliers still capped', () => assert(opt20.tiers.every(t => t.newMultiplier <= t.multiplier * 1.501), 'Exceeded cap'));

// ── Scenario 4: Manual edit — lock tier 4 higher ──
console.log('\n📊 SCENARIO 4: Lock tier 4 at 4.00x (was 3.33x), 5% target');
const opt4locked = optimize(analysis, 5, { 4: 4.00 });
const tier4 = opt4locked.tiers.find(t => t.id === 4);
console.log(`  Tier 4: ${tier4.multiplier.toFixed(2)}x → ${tier4.newMultiplier.toFixed(2)}x (LOCKED)`);
console.log(`  Target: ${fmt(opt4locked.targetProfit)} | Projected: ${fmt(opt4locked.projectedProfit)}`);
opt4locked.tiers.filter(t => t.partCount > 0 && !t.isLocked).forEach(t => {
  console.log(`  Tier ${t.id}: ${t.multiplier.toFixed(2)}x → ${t.newMultiplier.toFixed(2)}x`);
});

test('Tier 4 is locked at 4.00x', () => assert(tier4.newMultiplier === 4.00, `Got ${tier4.newMultiplier}`));
test('Tier 4 is marked locked', () => assert(tier4.isLocked === true, 'Not locked'));

// ── Scenario 5: Manual edit — lock tier 4 LOWER ──
console.log('\n📊 SCENARIO 5: Lock tier 4 at 2.50x (BELOW original 3.33x)');
const opt4low = optimize(analysis, 5, { 4: 2.50 });
const tier4low = opt4low.tiers.find(t => t.id === 4);
console.log(`  Tier 4: ${tier4low.multiplier.toFixed(2)}x → ${tier4low.newMultiplier.toFixed(2)}x (LOCKED LOW)`);
console.log(`  Target: ${fmt(opt4low.targetProfit)} | Projected: ${fmt(opt4low.projectedProfit)}`);
const gap4low = Math.abs(opt4low.projectedProfit - opt4low.targetProfit) / opt4low.targetProfit * 100;
console.log(`  Gap from target: ${pct(gap4low)}`);

test('Tier 4 locked at 2.50x', () => assert(tier4low.newMultiplier === 2.50, `Got ${tier4low.newMultiplier}`));
test('Other tiers compensate (projected near target)', () => assert(gap4low < 2, `Gap: ${pct(gap4low)}`));

// ── Scenario 6: Lock multiple tiers ──
console.log('\n📊 SCENARIO 6: Lock tiers 2, 4, 6 simultaneously');
const optMulti = optimize(analysis, 10, { 2: 5.00, 4: 3.50, 6: 3.00 });
console.log(`  Target: ${fmt(optMulti.targetProfit)} | Projected: ${fmt(optMulti.projectedProfit)}`);
optMulti.tiers.filter(t => t.partCount > 0).forEach(t => {
  const tag = t.isLocked ? ' 🔒' : '';
  console.log(`  Tier ${t.id}: ${t.multiplier.toFixed(2)}x → ${t.newMultiplier.toFixed(2)}x${tag}`);
});

test('Tier 2 locked at 5.00x', () => assert(optMulti.tiers.find(t => t.id === 2).newMultiplier === 5.00));
test('Tier 4 locked at 3.50x', () => assert(optMulti.tiers.find(t => t.id === 4).newMultiplier === 3.50));
test('Tier 6 locked at 3.00x', () => assert(optMulti.tiers.find(t => t.id === 6).newMultiplier === 3.00));

// ── Scenario 7: Lock ALL tiers ──
console.log('\n📊 SCENARIO 7: Lock ALL tiers (edge case)');
const allLocks = {};
analysis.forEach(t => { allLocks[t.id] = t.multiplier + 0.5; });
const optAll = optimize(analysis, 10, allLocks);
console.log(`  All tiers locked. Iterations: ${optAll.iterations}`);
test('Enforcer exits early (0 iterations)', () => assert(optAll.iterations === 0, `Took ${optAll.iterations} iterations`));

// ── Scenario 8: Reset (empty locks) ──
console.log('\n📊 SCENARIO 8: Reset — no locks, same 5% target');
const optReset = optimize(analysis, 5, {});
const optFresh = optimize(analysis, 5);
console.log(`  Reset projected: ${fmt(optReset.projectedProfit)} | Fresh projected: ${fmt(optFresh.projectedProfit)}`);
test('Reset matches fresh calculation', () => {
  const diff = Math.abs(optReset.projectedProfit - optFresh.projectedProfit);
  assert(diff < 1, `Difference: ${fmt(diff)}`);
});

// ── Scenario 9: 50% target (stress test) ──
console.log('\n📊 SCENARIO 9: 50% profit increase (stress test)');
const opt50 = optimize(analysis, 50);
console.log(`  Target: ${fmt(opt50.targetProfit)} | Projected: ${fmt(opt50.projectedProfit)} | Iterations: ${opt50.iterations}`);
const gap50 = Math.abs(opt50.projectedProfit - opt50.targetProfit) / opt50.targetProfit * 100;
test('Converges within 5% (may hit caps)', () => assert(gap50 < 5 || opt50.projectedProfit > opt50.targetProfit * 0.95, `Gap: ${pct(gap50)}`));

// ── Summary ──
console.log(`\n${'═'.repeat(50)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
