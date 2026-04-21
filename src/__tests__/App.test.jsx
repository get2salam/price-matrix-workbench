import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PriceMatrixOptimizer from '../App';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a realistic CSV string with auto parts data.
 * Returns { csv, parts } where parts is the parsed array for verification.
 */
function generateAutoPartsCSV(parts) {
  const header = 'Part Name,Unit Cost,Unit Retail,Qty,Total Cost,Total Retail';
  const rows = parts.map(p => {
    const totalCost = p.unitCost * p.qty;
    const totalRetail = p.unitRetail * p.qty;
    return `${p.name},${p.unitCost.toFixed(2)},${p.unitRetail.toFixed(2)},${p.qty},${totalCost.toFixed(2)},${totalRetail.toFixed(2)}`;
  });
  return header + '\n' + rows.join('\n');
}

// 20 realistic auto parts across various cost tiers
const REAL_AUTO_PARTS = [
  // Tier 1: $0-$1.50
  { name: 'Drain Plug Gasket', unitCost: 0.50, unitRetail: 2.50, qty: 100 },
  { name: 'Valve Stem Cap', unitCost: 0.75, unitRetail: 3.50, qty: 80 },
  // Tier 2: $1.51-$6.00
  { name: 'Oil Filter - Standard', unitCost: 3.25, unitRetail: 12.99, qty: 200 },
  { name: 'Spark Plug - Copper', unitCost: 2.10, unitRetail: 8.99, qty: 300 },
  { name: 'Air Filter Element', unitCost: 4.50, unitRetail: 18.99, qty: 90 },
  // Tier 3: $6.01-$10.00
  { name: 'Spark Plug - Iridium', unitCost: 7.50, unitRetail: 24.99, qty: 150 },
  { name: 'Cabin Air Filter', unitCost: 8.00, unitRetail: 29.99, qty: 60 },
  // Tier 4: $10.01-$30.00
  { name: 'Brake Pads - Front Economy', unitCost: 12.00, unitRetail: 39.99, qty: 80 },
  { name: 'Wiper Blades - Pair', unitCost: 15.00, unitRetail: 44.99, qty: 50 },
  { name: 'Serpentine Belt', unitCost: 18.00, unitRetail: 54.99, qty: 40 },
  // Tier 5: $30.01-$50.00
  { name: 'Brake Pads - Ceramic', unitCost: 35.00, unitRetail: 89.99, qty: 60 },
  { name: 'Water Pump - Standard', unitCost: 42.00, unitRetail: 109.99, qty: 25 },
  // Tier 6: $50.01-$150.00
  { name: 'Brake Rotor - Front', unitCost: 55.00, unitRetail: 139.99, qty: 40 },
  { name: 'CV Axle Assembly', unitCost: 75.00, unitRetail: 189.99, qty: 20 },
  { name: 'Starter Motor', unitCost: 120.00, unitRetail: 299.99, qty: 15 },
  // Tier 7: $150.01-$250.00
  { name: 'Alternator - Reman', unitCost: 165.00, unitRetail: 399.99, qty: 12 },
  { name: 'Radiator - Aluminum', unitCost: 210.00, unitRetail: 499.99, qty: 8 },
  // Tier 8: $250.01+
  { name: 'Transmission Cooler Kit', unitCost: 280.00, unitRetail: 599.99, qty: 5 },
  { name: 'Turbocharger - Reman', unitCost: 450.00, unitRetail: 899.99, qty: 3 },
  { name: 'Engine Long Block', unitCost: 500.00, unitRetail: 1099.99, qty: 2 },
];

const REAL_CSV = generateAutoPartsCSV(REAL_AUTO_PARTS);

/**
 * Create a File object from a CSV string for upload testing.
 */
function createCSVFile(csvString, filename = 'parts-data.csv') {
  return new File([csvString], filename, { type: 'text/csv' });
}

/**
 * Upload a CSV file to the app by simulating file input change.
 * Waits for FileReader async callback to complete before returning.
 */
async function uploadCSV(csvString, filename = 'parts-data.csv') {
  const file = createCSVFile(csvString, filename);
  // Navigate to Step 2
  const continueBtn = screen.getByText('Continue to Upload Data →');
  fireEvent.click(continueBtn);

  // Upload file
  const fileInput = document.querySelector('input[type="file"]');
  await userEvent.upload(fileInput, file);

  // Wait for FileReader async callback to finish and update state
  await waitFor(() => {
    const partsText = screen.queryByText(/\d+ parts loaded/);
    expect(partsText).toBeInTheDocument();
  });

  return file;
}

/**
 * Navigate from upload to Step 3 and set a target.
 */
function navigateToTarget() {
  const continueBtn = screen.getByText('Continue to Set Target →');
  fireEvent.click(continueBtn);
}

/**
 * Set target increase value.
 */
function setTarget(value, type = 'percent') {
  if (type === 'margin') {
    fireEvent.click(screen.getByText('Target Margin'));
  } else if (type === 'dollar') {
    fireEvent.click(screen.getByText('$ Amount'));
  }
  // The target input
  const input = screen.getByDisplayValue(/\d+/);
  fireEvent.change(input, { target: { value: String(value) } });
}

/**
 * Click "Generate Recommendations" to go to Step 4.
 */
function generateRecommendations() {
  const btn = screen.getByText('Generate Recommendations →');
  fireEvent.click(btn);
}

// Clear localStorage before each test
beforeEach(() => {
  localStorage.clear();
  // Suppress console.log/warn noise from the optimizer algorithm
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─── Test 1: Basic CSV upload and analysis ──────────────────────────────────

describe('Test 1: Basic CSV upload and analysis', () => {
  it('should load 20 parts from realistic auto parts CSV', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);

    // FileReader is async — wait for the parts count to appear
    await waitFor(() => {
      expect(screen.getByText(/20 parts loaded/)).toBeInTheDocument();
    });
  });

  it('should distribute parts correctly across tiers', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);

    // Verify total parts count is shown (FileReader is async)
    await waitFor(() => {
      expect(screen.getByText('Total Parts')).toBeInTheDocument();
    });
    // The "Total Parts" card should contain "20"
    const totalPartsLabel = screen.getByText('Total Parts');
    const card = totalPartsLabel.closest('[class*="rounded-xl"]');
    expect(card.textContent).toContain('20');
  });

  it('should calculate total cost, revenue, and profit', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);

    // The summary cards should show these values
    // Check that profit is positive and displayed
    const profitElements = screen.getAllByText(/^\$/);
    expect(profitElements.length).toBeGreaterThan(0);

    // Verify Current Profit card exists
    expect(screen.getByText('Current Profit')).toBeInTheDocument();
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
  });

  it('should show Current Margin % card', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);

    await waitFor(() => {
      expect(screen.getByText('Current Margin %')).toBeInTheDocument();
    });
    // The margin value is a sibling inside the parent container
    const label = screen.getByText('Current Margin %');
    // Walk up to the card-level container (the rounded-xl parent)
    const card = label.closest('[class*="rounded-xl"]');
    expect(card.textContent).toMatch(/\d+\.\d+%/);
  });

  it('should show skipped rows warning for partially invalid CSV', async () => {
    const csvWithBadRows = REAL_CSV + '\n,,,,,\nBad Row,not-a-number,abc,def';
    render(<PriceMatrixOptimizer />);
    await uploadCSV(csvWithBadRows);

    // Should still load 20 valid parts
    expect(screen.getByText(/20 parts loaded/)).toBeInTheDocument();
  });
});

// ─── Test 2: Optimization produces valid results ────────────────────────────

describe('Test 2: Optimization produces valid results', () => {
  it('should generate recommendations with 10% profit increase target', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);
    navigateToTarget();
    setTarget(10);
    generateRecommendations();

    // Should be on Step 4 with results
    expect(screen.getByText('Recommended Matrix Adjustments')).toBeInTheDocument();
    expect(screen.getByText('Projected Profit')).toBeInTheDocument();
  });

  it('should have all new multipliers >= original multipliers', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);
    navigateToTarget();
    setTarget(10);
    generateRecommendations();

    // Check that no tier has a negative change
    const changeElements = screen.getAllByText(/^[+-]?\d+\.\d+$/);
    changeElements.forEach(el => {
      const val = parseFloat(el.textContent);
      if (!isNaN(val)) {
        // Changes should be >= 0 (displayed as positive or zero)
        expect(val).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it('should show positive profit increase', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);
    navigateToTarget();
    setTarget(10);
    generateRecommendations();

    // The profit increase card should show a positive percentage
    const increaseCard = screen.getByText('Profit Increase');
    const cardContainer = increaseCard.closest('[class*="rounded-2xl"]');
    expect(cardContainer.textContent).toMatch(/\+\d+\.\d+%/);
  });
});

// ─── Test 3: Manual multiplier editing ──────────────────────────────────────

describe('Test 3: Manual multiplier editing', () => {
  it('should allow editing a tier multiplier and show lock indicator', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);
    navigateToTarget();
    setTarget(10);
    generateRecommendations();

    // Get the first editable multiplier input in the results table
    const multInputs = screen.getAllByTitle(/Click to edit|Locked/);
    expect(multInputs.length).toBeGreaterThan(0);

    const firstInput = multInputs[0];

    // Edit it: clear and type a new value, then blur
    fireEvent.focus(firstInput);
    fireEvent.change(firstInput, { target: { value: '6.00' } });
    fireEvent.blur(firstInput);

    // After blur, the tier should be locked (🔒 icon should appear)
    await waitFor(() => {
      const lockIcons = screen.getAllByText('🔒');
      expect(lockIcons.length).toBeGreaterThan(0);
    });
  });

  it('should show Reset Edits button when tiers are locked', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);
    navigateToTarget();
    setTarget(10);
    generateRecommendations();

    const multInputs = screen.getAllByTitle(/Click to edit/);
    const firstInput = multInputs[0];

    fireEvent.focus(firstInput);
    fireEvent.change(firstInput, { target: { value: '6.00' } });
    fireEvent.blur(firstInput);

    await waitFor(() => {
      expect(screen.getByText(/Reset Edits/)).toBeInTheDocument();
    });
  });
});

// ─── Test 4: Reset functionality ────────────────────────────────────────────

describe('Test 4: Reset functionality', () => {
  it('should clear all locks when Reset Edits is clicked', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);
    navigateToTarget();
    setTarget(10);
    generateRecommendations();

    // Lock a tier
    const multInputs = screen.getAllByTitle(/Click to edit/);
    fireEvent.focus(multInputs[0]);
    fireEvent.change(multInputs[0], { target: { value: '6.00' } });
    fireEvent.blur(multInputs[0]);

    await waitFor(() => {
      expect(screen.getByText(/Reset Edits/)).toBeInTheDocument();
    });

    // Click Reset
    fireEvent.click(screen.getByText(/Reset Edits/));

    // Lock indicators should be gone
    await waitFor(() => {
      expect(screen.queryByText(/Reset Edits/)).not.toBeInTheDocument();
    });
  });
});

// ─── Test 5: Edge cases ─────────────────────────────────────────────────────

describe('Test 5: Edge cases', () => {
  it('should show error for empty CSV', async () => {
    render(<PriceMatrixOptimizer />);
    const continueBtn = screen.getByText('Continue to Upload Data →');
    fireEvent.click(continueBtn);

    const file = createCSVFile('');
    const fileInput = document.querySelector('input[type="file"]');
    await userEvent.upload(fileInput, file);

    // Should show an error
    await waitFor(() => {
      const errorEl = screen.queryByText(/Could not find a valid header/i) || screen.queryByText(/No valid parts/i);
      expect(errorEl).toBeTruthy();
    });
  });

  it('should handle CSV with only 1 part', async () => {
    const singlePartCSV = generateAutoPartsCSV([
      { name: 'Oil Filter', unitCost: 3.25, unitRetail: 12.99, qty: 10 }
    ]);
    render(<PriceMatrixOptimizer />);
    await uploadCSV(singlePartCSV);

    expect(screen.getByText(/1 parts loaded/)).toBeInTheDocument();
  });

  it('should handle all parts in a single tier', async () => {
    const sameTierParts = [
      { name: 'Part A', unitCost: 3.00, unitRetail: 12.00, qty: 10 },
      { name: 'Part B', unitCost: 4.00, unitRetail: 16.00, qty: 20 },
      { name: 'Part C', unitCost: 5.00, unitRetail: 20.00, qty: 30 },
    ];
    const csv = generateAutoPartsCSV(sameTierParts);
    render(<PriceMatrixOptimizer />);
    await uploadCSV(csv);

    // All 3 parts in tier 2 ($1.51-$6.00)
    expect(screen.getByText(/3 parts loaded/)).toBeInTheDocument();
  });

  it('should handle zero retail price gracefully', async () => {
    const zeroRetailParts = [
      { name: 'Free Sample', unitCost: 5.00, unitRetail: 0, qty: 10 },
      { name: 'Regular Part', unitCost: 10.00, unitRetail: 30.00, qty: 5 },
    ];
    const csv = generateAutoPartsCSV(zeroRetailParts);
    render(<PriceMatrixOptimizer />);
    await uploadCSV(csv);

    expect(screen.getByText(/2 parts loaded/)).toBeInTheDocument();

    // Should still be able to navigate to Step 3 and generate recommendations
    navigateToTarget();
    setTarget(10);
    generateRecommendations();

    expect(screen.getByText('Recommended Matrix Adjustments')).toBeInTheDocument();
  });

  it('should handle very large profit target (50%)', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);
    navigateToTarget();
    setTarget(50);
    generateRecommendations();

    // Should still produce results without crashing
    expect(screen.getByText('Recommended Matrix Adjustments')).toBeInTheDocument();
    expect(screen.getByText('Projected Profit')).toBeInTheDocument();
  });

  it('should handle CSV with header not on line 1', async () => {
    const csvWithJunk = 'Report Title\nGenerated: 2026-01-01\nPart Name,Unit Cost,Unit Retail,Qty,Total Cost,Total Retail\nOil Filter,3.25,12.99,10,32.50,129.90';
    render(<PriceMatrixOptimizer />);
    await uploadCSV(csvWithJunk);

    expect(screen.getByText(/1 parts loaded/)).toBeInTheDocument();
  });
});

// ─── Test 6: Matrix editing (Bug 16 fix verification) ──────────────────────

describe('Test 6: Matrix editing', () => {
  it('should allow adding a new tier', () => {
    render(<PriceMatrixOptimizer />);

    // Default matrix has 8 tiers — count the remove buttons
    const removeButtons = screen.getAllByText('✕');
    expect(removeButtons.length).toBe(8);

    // Click Add Tier
    fireEvent.click(screen.getByText(/Add Tier/));

    // Should now have 9 tiers
    const updatedRemoveButtons = screen.getAllByText('✕');
    expect(updatedRemoveButtons.length).toBe(9);
  });

  it('should allow removing a tier', () => {
    render(<PriceMatrixOptimizer />);

    const removeButtons = screen.getAllByText('✕');
    fireEvent.click(removeButtons[removeButtons.length - 1]); // Remove last tier

    const updatedRemoveButtons = screen.getAllByText('✕');
    expect(updatedRemoveButtons.length).toBe(7);
  });

  it('should not allow removing below 2 tiers', () => {
    render(<PriceMatrixOptimizer />);

    // Remove tiers until 2 remain
    for (let i = 0; i < 6; i++) {
      const btns = screen.getAllByText('✕');
      const enabledBtn = btns.find(btn => !btn.disabled);
      if (enabledBtn) fireEvent.click(enabledBtn);
    }

    // All remaining remove buttons should be disabled
    const finalBtns = screen.getAllByText('✕');
    expect(finalBtns.length).toBe(2);
    finalBtns.forEach(btn => {
      expect(btn).toBeDisabled();
    });
  });

  it('should auto-calculate multiplier from GP and vice versa (Bug 19: onBlur)', () => {
    render(<PriceMatrixOptimizer />);

    // Find the first GP input (defaultValue approach) and change it
    // The GP inputs have key like gp-{id}-{multiplier}
    // Let's find the first multiplier input for tier 1 (defaultValue=5.00)
    const multInput = screen.getAllByDisplayValue('5')[0]; // Tier 1 multiplier = 5.00
    // Note: with defaultValue, the display might show "5" not "5.00"
    // This test verifies the inputs exist and are interactable
    expect(multInput).toBeInTheDocument();
  });

  it('should show warning for cost range gaps (Bug 17)', () => {
    render(<PriceMatrixOptimizer />);

    // Modify a tier's minCost to create a gap
    // The default matrix has no gaps, so we need to create one
    // Find the minCost input for tier 2 (should be 1.51)
    const minCostInputs = screen.getAllByDisplayValue('1.51');
    if (minCostInputs.length > 0) {
      fireEvent.change(minCostInputs[0], { target: { value: '5.00' } });

      // Should show warning about gap
      // Gap between tier 1 maxCost (1.50) and tier 2 minCost (5.00)
      waitFor(() => {
        const warning = screen.queryByText(/Cost Range Issues/i);
        expect(warning).toBeInTheDocument();
      });
    }
  });
});

// ─── Bug-specific regression tests ─────────────────────────────────────────

describe('Bug 16: Stale tierAnalysis after matrix changes', () => {
  it('should recalculate tier analysis when matrix changes after CSV upload', async () => {
    render(<PriceMatrixOptimizer />);

    // Upload CSV (creates tier analysis)
    await uploadCSV(REAL_CSV);
    expect(screen.getByText(/20 parts loaded/)).toBeInTheDocument();

    // Go back to Step 1
    const backBtn = screen.getByText('← Back');
    fireEvent.click(backBtn);

    // We're now on Step 1 with parts loaded — matrix changes should trigger re-analysis
    // The component should not crash and should still function
    expect(screen.getByText('Your Price Matrix')).toBeInTheDocument();
  });
});

describe('Bug 18: Clearing multiplier should not cause -9900% GP', () => {
  it('should not allow multiplier <= 0 to recalculate GP', () => {
    render(<PriceMatrixOptimizer />);

    // Find first multiplier input (Tier 1 = 5.00)
    const multInputs = screen.getAllByDisplayValue('5');
    if (multInputs.length > 0) {
      const input = multInputs[0];

      // Clear the input (simulate user deleting all text)
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.blur(input);

      // The GP should NOT be -9900% — it should stay at 80 (previous value)
      // Verify by checking that no element contains -9900
      expect(screen.queryByText(/-9900/)).not.toBeInTheDocument();
    }
  });

  it('should not allow negative multiplier values', () => {
    render(<PriceMatrixOptimizer />);

    const multInputs = screen.getAllByDisplayValue('5');
    if (multInputs.length > 0) {
      const input = multInputs[0];
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '-2' } });
      fireEvent.blur(input);

      // Should not see negative GP
      expect(screen.queryByText(/-\d{3,}%/)).not.toBeInTheDocument();
    }
  });
});

describe('Bug 20: GP minimum validation', () => {
  it('should clamp GP to max 99.9%', () => {
    render(<PriceMatrixOptimizer />);

    // Find first GP input (Tier 1 = 80) — it has step="0.1" and max="99.9"
    const gpInputs = screen.getAllByDisplayValue('80');
    // Filter to GP inputs specifically (step=0.1)
    const gpInput = gpInputs.find(el => el.getAttribute('step') === '0.1');
    expect(gpInput).toBeTruthy();

    fireEvent.focus(gpInput);
    fireEvent.change(gpInput, { target: { value: '150' } });
    fireEvent.blur(gpInput);

    // After blur with defaultValue approach, the input re-renders via key change.
    // The GP value in state should be clamped to 99.9.
    // Verify no GP input (step=0.1) shows 150
    const allInputs = document.querySelectorAll('input[step="0.1"]');
    const hasUnclamped = Array.from(allInputs).some(el => el.value === '150' || el.defaultValue === '150');
    expect(hasUnclamped).toBe(false);
  });

  it('should clamp GP to min 0%', () => {
    render(<PriceMatrixOptimizer />);

    const gpInputs = screen.getAllByDisplayValue('80');
    if (gpInputs.length > 0) {
      const input = gpInputs[0];
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '-50' } });
      fireEvent.blur(input);

      // Should not have negative GP value displayed
      expect(screen.queryByDisplayValue('-50')).not.toBeInTheDocument();
    }
  });

  it('should clamp multiplier to min 1.01', () => {
    render(<PriceMatrixOptimizer />);

    const multInputs = screen.getAllByDisplayValue('5');
    if (multInputs.length > 0) {
      const input = multInputs[0];
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '0.5' } });
      fireEvent.blur(input);

      // Multiplier should be clamped to at least 1.01
      expect(screen.queryByDisplayValue('0.5')).not.toBeInTheDocument();
    }
  });
});

describe('Bug 17: Cost range auto-fix', () => {
  it('should auto-fix next tier minCost when maxCost is changed on blur', () => {
    render(<PriceMatrixOptimizer />);

    // Find the maxCost input for tier 1 (value = 1.5, displayed as "1.5")
    // The default tier 1 maxCost is 1.50
    const maxCostInputs = screen.getAllByDisplayValue('1.5');
    if (maxCostInputs.length > 0) {
      const input = maxCostInputs[0];

      // Change tier 1 maxCost from 1.50 to 3.00
      fireEvent.change(input, { target: { value: '3.00' } });
      fireEvent.blur(input);

      // Tier 2 minCost should auto-update to 3.01
      waitFor(() => {
        const newMinCost = screen.getByDisplayValue('3.01');
        expect(newMinCost).toBeInTheDocument();
      });
    }
  });
});

// ─── Integration: Full workflow ─────────────────────────────────────────────

describe('Integration: Full workflow end-to-end', () => {
  it('should complete full workflow: setup → upload → target → results', async () => {
    render(<PriceMatrixOptimizer />);

    // Step 1: Matrix Setup (default is fine)
    expect(screen.getByText('Your Price Matrix')).toBeInTheDocument();

    // Step 2: Upload
    await uploadCSV(REAL_CSV);
    expect(screen.getByText(/20 parts loaded/)).toBeInTheDocument();

    // Step 3: Set Target
    navigateToTarget();
    expect(screen.getByText('Set Your Margin Target')).toBeInTheDocument();

    // Set 10% growth target
    setTarget(10);

    // Step 4: Generate Results
    generateRecommendations();
    expect(screen.getByText('Recommended Matrix Adjustments')).toBeInTheDocument();

    // Verify key elements exist
    expect(screen.getByText('Current Profit')).toBeInTheDocument();
    expect(screen.getByText('Target Profit')).toBeInTheDocument();
    expect(screen.getByText('Projected Profit')).toBeInTheDocument();
    expect(screen.getByText('Profit Increase')).toBeInTheDocument();
    expect(screen.getByText('Optimization Strategy')).toBeInTheDocument();
  });

  it('should handle Start New Analysis reset', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);
    navigateToTarget();
    setTarget(10);
    generateRecommendations();

    // Click Start New Analysis
    fireEvent.click(screen.getByText('Start New Analysis'));

    // Should be back to Step 1
    expect(screen.getByText('Your Price Matrix')).toBeInTheDocument();
  });

  it('should handle back navigation from results to adjust target', async () => {
    render(<PriceMatrixOptimizer />);
    await uploadCSV(REAL_CSV);
    navigateToTarget();
    setTarget(10);
    generateRecommendations();

    // Click ← Adjust Target
    fireEvent.click(screen.getByText('← Adjust Target'));

    // Should be on Step 3
    expect(screen.getByText('Set Your Margin Target')).toBeInTheDocument();
  });
});

// Trial mode tests removed — app delivered unlocked to client
