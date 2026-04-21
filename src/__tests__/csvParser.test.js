/**
 * Unit tests for src/utils/csvParser.js
 *
 * Covers the CSV parser internals plus end-to-end parseCSV() integration
 * with real-world POS export quirks.
 */

import { describe, it, expect } from 'vitest';
import {
  splitCSVLine,
  findHeaderRow,
  resolveTotalCost,
  resolveTotalRetail,
  parseCSV,
} from '../utils/csvParser.js';

// ─── splitCSVLine ────────────────────────────────────────────────────────────

describe('splitCSVLine', () => {
  it('splits a simple CSV line', () => {
    expect(splitCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields containing commas', () => {
    expect(splitCSVLine('"Smith, John",10.00,5')).toEqual(['Smith, John', '10.00', '5']);
  });

  it('handles escaped double-quotes inside quoted fields', () => {
    expect(splitCSVLine('"Oil Filter ""Premium""",3.25,100')).toEqual([
      'Oil Filter "Premium"',
      '3.25',
      '100',
    ]);
  });

  it('trims whitespace from fields', () => {
    expect(splitCSVLine('  a  ,  b  ,  c  ')).toEqual(['a', 'b', 'c']);
  });

  it('handles empty fields', () => {
    expect(splitCSVLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('handles trailing comma (empty last field)', () => {
    expect(splitCSVLine('a,b,')).toEqual(['a', 'b', '']);
  });

  it('handles single field with no comma', () => {
    expect(splitCSVLine('only one')).toEqual(['only one']);
  });

  it('handles currency-formatted values', () => {
    const fields = splitCSVLine('"$1,234.56",10,2');
    expect(fields).toEqual(['$1,234.56', '10', '2']);
  });

  it('handles blank line', () => {
    expect(splitCSVLine('')).toEqual(['']);
  });
});

// ─── findHeaderRow ───────────────────────────────────────────────────────────

describe('findHeaderRow', () => {
  it('finds header on line 0', () => {
    const lines = [
      'Part Name,Unit Cost,Unit Retail,Qty',
      'Oil Filter,3.25,12.99,10',
    ];
    const { headerRowIndex, headers } = findHeaderRow(lines);
    expect(headerRowIndex).toBe(0);
    expect(headers).toContain('unit cost');
  });

  it('finds header on line 2 (after junk lines)', () => {
    const lines = [
      'Report Title: Parts Sales',
      'Generated: 2026-01-01',
      'Part Name,Unit Cost,Qty',
      'Oil Filter,3.25,10',
    ];
    const { headerRowIndex } = findHeaderRow(lines);
    expect(headerRowIndex).toBe(2);
  });

  it('returns -1 when no header found within maxLines', () => {
    const lines = ['junk line', 'another junk line', 'still junk'];
    const { headerRowIndex } = findHeaderRow(lines, 3);
    expect(headerRowIndex).toBe(-1);
  });

  it('recognises "price" as a valid header keyword', () => {
    const lines = ['Part,Sell Price,Qty', 'Widget,5.00,10'];
    const { headerRowIndex } = findHeaderRow(lines);
    expect(headerRowIndex).toBe(0);
  });

  it('is case-insensitive', () => {
    const lines = ['PART NAME,UNIT COST,QTY', 'Oil Filter,3.25,10'];
    const { headerRowIndex } = findHeaderRow(lines);
    expect(headerRowIndex).toBe(0);
  });
});

// ─── resolveTotalCost ────────────────────────────────────────────────────────

describe('resolveTotalCost', () => {
  it('uses calculated total when csvTotal is 0', () => {
    expect(resolveTotalCost(10, 5, 0)).toBe(50);
  });

  it('uses csvTotal when it matches calculated within 50%', () => {
    // calculated=50, csvTotal=45 → diff=10% → trust CSV
    expect(resolveTotalCost(10, 5, 45)).toBe(45);
  });

  it('falls back to calculated total when csvTotal diverges >50%', () => {
    // calculated=50, csvTotal=10 → diff=80% → use calculated
    expect(resolveTotalCost(10, 5, 10)).toBe(50);
  });

  it('uses calculated when qty=0 and csvTotal=0', () => {
    expect(resolveTotalCost(10, 0, 0)).toBe(0);
  });

  it('uses calculated total when csvTotal=0.001 (below threshold)', () => {
    // csvTotal ≤ 0.01 → fall back to calculated
    expect(resolveTotalCost(10, 5, 0.001)).toBe(50);
  });
});

// ─── resolveTotalRetail ──────────────────────────────────────────────────────

describe('resolveTotalRetail', () => {
  it('uses calculated retail when csvTotal is 0', () => {
    expect(resolveTotalRetail(25, 4, 0)).toBe(100);
  });

  it('uses csvTotal when within tolerance', () => {
    // calculated=100, csvTotal=98 → diff=2% → trust CSV
    expect(resolveTotalRetail(25, 4, 98)).toBe(98);
  });

  it('falls back to calculated when csvTotal diverges >50%', () => {
    // calculated=100, csvTotal=20 → diff=80% → use calculated
    expect(resolveTotalRetail(25, 4, 20)).toBe(100);
  });
});

// ─── parseCSV (integration) ──────────────────────────────────────────────────

function makeCSV(headerLine, rows) {
  return [headerLine, ...rows].join('\n');
}

const STANDARD_HEADER = 'Part Name,Unit Cost,Unit Retail,Qty,Total Cost,Total Retail';

function makeRow(name, cost, retail, qty) {
  const tc = (cost * qty).toFixed(2);
  const tr = (retail * qty).toFixed(2);
  return `${name},${cost.toFixed(2)},${retail.toFixed(2)},${qty},${tc},${tr}`;
}

describe('parseCSV', () => {
  describe('success cases', () => {
    it('parses a well-formed CSV with all columns', () => {
      const csv = makeCSV(STANDARD_HEADER, [
        makeRow('Oil Filter', 3.25, 12.99, 10),
        makeRow('Brake Pads', 18.0, 54.99, 5),
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts).toHaveLength(2);
      expect(result.parts[0].unitCost).toBeCloseTo(3.25, 2);
      expect(result.parts[1].unitRetail).toBeCloseTo(54.99, 2);
    });

    it('strips UTF-8 BOM', () => {
      const csv = '\uFEFF' + makeCSV(STANDARD_HEADER, [makeRow('Filter', 3.0, 12.0, 1)]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts).toHaveLength(1);
    });

    it('handles Windows \\r\\n line endings', () => {
      const csv = [STANDARD_HEADER, makeRow('Oil Filter', 3.25, 12.99, 10)].join('\r\n');
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts).toHaveLength(1);
    });

    it('skips zero-cost rows and counts them as skipped', () => {
      const csv = makeCSV(STANDARD_HEADER, [
        makeRow('Regular Part', 3.25, 12.99, 10),
        makeRow('Free Warranty', 0, 0, 1),   // zero cost → skip
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts).toHaveLength(1);
      expect(result.skippedCount).toBe(1);
    });

    it('skips blank rows without counting them (just silently)', () => {
      const csv = makeCSV(STANDARD_HEADER, [
        makeRow('Oil Filter', 3.25, 12.99, 10),
        '',
        makeRow('Brake Pads', 18.0, 54.99, 5),
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts).toHaveLength(2);
    });

    it('handles header not on line 1 (after junk lines)', () => {
      const csv = [
        'Auto Parts Store — Monthly Report',
        'Generated: 2026-03-18',
        STANDARD_HEADER,
        makeRow('Oil Filter', 3.25, 12.99, 10),
      ].join('\n');
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts).toHaveLength(1);
    });

    it('handles currency-formatted values in fields', () => {
      const csv = makeCSV(STANDARD_HEADER, [
        '"Oil Filter","$3.25","$12.99","10","$32.50","$129.90"',
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts[0].unitCost).toBeCloseTo(3.25, 2);
      expect(result.parts[0].unitRetail).toBeCloseTo(12.99, 2);
    });

    it('handles CSV without retail column (defaults to 0)', () => {
      const csv = makeCSV('Part Name,Unit Cost,Qty', [
        'Oil Filter,3.25,10',
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts[0].unitRetail).toBe(0);
    });

    it('handles CSV without qty column (defaults qty to 1)', () => {
      const csv = makeCSV('Part Name,Unit Cost,Unit Retail', [
        'Oil Filter,3.25,12.99',
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts[0].qty).toBe(1);
    });

    it('applies self-healing: uses CSV total when close to calculated', () => {
      // CSV total is 32.49 vs calculated 32.50 → diff 0.03% → use CSV value
      const csv = makeCSV(STANDARD_HEADER, [
        'Oil Filter,3.25,12.99,10,32.49,129.90',
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts[0].totalCost).toBeCloseTo(32.49, 2);
    });

    it('applies self-healing: uses calculated total when CSV diverges', () => {
      // Calculated: 3.25*10=32.50, CSV says 5.00 → diff 84% → use calculated
      const csv = makeCSV(STANDARD_HEADER, [
        'Oil Filter,3.25,12.99,10,5.00,129.90',
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts[0].totalCost).toBeCloseTo(32.50, 2);
    });
  });

  describe('error cases', () => {
    it('returns error for empty CSV', () => {
      const result = parseCSV('');
      expect(result.error).not.toBeNull();
      expect(result.parts).toHaveLength(0);
    });

    it('returns error when no header row is found', () => {
      const csv = ['Pure junk line', 'Another junk line'].join('\n');
      const result = parseCSV(csv);
      expect(result.error).toMatch(/header row/i);
      expect(result.parts).toHaveLength(0);
    });

    it('returns error when unit cost column is missing', () => {
      const csv = makeCSV('Part Name,Unit Retail,Qty', [
        'Oil Filter,12.99,10',
      ]);
      const result = parseCSV(csv);
      expect(result.error).toMatch(/unit cost/i);
    });

    it('returns error when all rows have zero cost', () => {
      const csv = makeCSV(STANDARD_HEADER, [
        'Free Warranty,0,0,1,0,0',
        'Another Free Item,0,0,2,0,0',
      ]);
      const result = parseCSV(csv);
      expect(result.error).toMatch(/no valid parts/i);
    });

    it('returns error for CSV with only a header row and no data', () => {
      const csv = makeCSV(STANDARD_HEADER, []);
      const result = parseCSV(csv);
      expect(result.error).not.toBeNull();
    });
  });

  describe('skipped row counting', () => {
    it('counts short rows as skipped', () => {
      const csv = makeCSV(STANDARD_HEADER, [
        makeRow('Oil Filter', 3.25, 12.99, 10),
        'Incomplete Row',  // fewer columns than required
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts).toHaveLength(1);
      expect(result.skippedCount).toBeGreaterThan(0);
    });

    it('counts zero-cost rows as skipped', () => {
      const csv = makeCSV(STANDARD_HEADER, [
        makeRow('Regular', 5.0, 15.0, 3),
        makeRow('Free Item', 0.0, 0.0, 1),
      ]);
      const result = parseCSV(csv);
      expect(result.skippedCount).toBe(1);
    });
  });

  describe('alternative column naming', () => {
    it('recognises "Buy Price" as the cost column', () => {
      const csv = makeCSV('Part,Buy Price,Sell Price,Qty', [
        'Filter,3.25,12.99,10',
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts[0].unitCost).toBeCloseTo(3.25, 2);
    });

    it('recognises "Sell Price" as the retail column', () => {
      const csv = makeCSV('Part,Unit Cost,Sell Price,Qty', [
        'Filter,3.25,12.99,10',
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts[0].unitRetail).toBeCloseTo(12.99, 2);
    });

    it('recognises "Quantity" as the qty column', () => {
      const csv = makeCSV('Part,Unit Cost,Unit Retail,Quantity', [
        'Filter,3.25,12.99,10',
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts[0].qty).toBe(10);
    });

    it('recognises "Ext Cost" as total cost column', () => {
      const csv = makeCSV('Part,Unit Cost,Unit Retail,Qty,Ext Cost,Ext Price', [
        'Filter,3.25,12.99,10,32.50,129.90',
      ]);
      const result = parseCSV(csv);
      expect(result.error).toBeNull();
      expect(result.parts[0].totalCost).toBeCloseTo(32.50, 2);
    });
  });
});
