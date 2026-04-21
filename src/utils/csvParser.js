/**
 * CSV parser for auto-parts sales data.
 *
 * Handles real-world CSV quirks commonly found in POS system exports:
 *  - UTF-8 BOM stripping
 *  - Windows-style \r\n line endings
 *  - Quoted fields containing commas (e.g. "Smith, John")
 *  - Escaped quotes inside quoted fields ("")
 *  - Currency-formatted numbers ($1,234.56)
 *  - Header rows that don't appear on line 1 (up to 10 lines down)
 *  - Self-healing: validates computed vs reported totals (≤50% tolerance)
 *
 * The parser returns a structured result with parsed parts and diagnostics.
 * It has no UI dependencies and can run in Node.js or a browser Worker.
 */

import { parseCurrency } from './pricingUtils.js';

/**
 * @typedef {Object} ParsedPart
 * @property {number} unitCost     - Unit cost (COG).
 * @property {number} unitRetail   - Unit retail / sell price.
 * @property {number} qty          - Quantity sold.
 * @property {number} totalCost    - Extended cost.
 * @property {number} totalRetail  - Extended retail.
 */

/**
 * @typedef {Object} ParseResult
 * @property {ParsedPart[]} parts        - Successfully parsed rows.
 * @property {number}       skippedCount - Number of rows skipped.
 * @property {string|null}  error        - Fatal error message, or null on success.
 */

// ─── Column name matchers ────────────────────────────────────────────────────

const COST_MATCHERS = [
  (h) => h === 'unit cost',
  (h) => h === 'buy price',
  (h) => h === 'cost',
  (h) => h === 'unitcost',
  (h) => h.includes('unit cost'),
  (h) => h.includes('buy price'),
];

const RETAIL_MATCHERS = [
  (h) => h === 'unit retail',
  (h) => h === 'sell price',
  (h) => h === 'retail',
  (h) => h === 'unitretail',
  (h) => h === 'price',
  (h) => h.includes('unit retail'),
  (h) => h.includes('sell price'),
];

const QTY_MATCHERS = [
  (h) => h === 'qty',
  (h) => h === 'quantity',
  (h) => h === 'sold',
  (h) => h.includes('qty'),
];

const TOTAL_COST_MATCHERS = [
  (h) => h.includes('total cost'),
  (h) => h.includes('ext cost'),
];

const TOTAL_RETAIL_MATCHERS = [
  (h) => h.includes('total retail'),
  (h) => h.includes('ext price'),
  (h) => h.includes('ext revenue'),
  (h) => h === 'amount',
  (h) => h === 'revenue',
  (h) => h.includes('amount'),
  (h) => h.includes('revenue'),
];

/**
 * Find the first matching column index using a list of predicate functions.
 *
 * @param {string[]} headers - Lowercase header tokens.
 * @param {Function[]} matchers - List of matcher predicates (header → bool).
 * @returns {number} Column index, or -1 if no match.
 */
function findColumnIndex(headers, matchers) {
  for (const matcher of matchers) {
    const idx = headers.findIndex(matcher);
    if (idx !== -1) return idx;
  }
  return -1;
}

// ─── RFC 4180 field splitter ─────────────────────────────────────────────────

/**
 * Split a single CSV line into fields, respecting RFC 4180 quoting rules.
 *
 * Handles:
 *  - Quoted fields containing commas
 *  - Escaped double-quotes ("")
 *  - Trailing commas (empty last field)
 *
 * @param {string} line - Raw CSV line.
 * @returns {string[]} Array of unquoted field values (whitespace-trimmed).
 */
export function splitCSVLine(line) {
  const fields = [];
  let current = '';
  let insideQuotes = false;

  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    const nextChar = line[j + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        j++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

// ─── Header scanner ──────────────────────────────────────────────────────────

const HEADER_KEYWORDS = ['cost', 'price', 'qty', 'quantity', 'total', 'retail', 'sell'];

/**
 * Scan the first `maxLines` rows to find the header row.
 *
 * Returns the header row index and the lowercase token array, or
 * `{ headerRowIndex: -1, headers: [] }` if no header is found.
 *
 * @param {string[]} lines - All non-empty lines from the CSV.
 * @param {number}   [maxLines=10] - Maximum number of lines to scan.
 * @returns {{ headerRowIndex: number, headers: string[] }}
 */
export function findHeaderRow(lines, maxLines = 10) {
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const lower = lines[i].toLowerCase();
    const hasKeyword = HEADER_KEYWORDS.some((kw) => lower.includes(kw));
    if (hasKeyword) {
      const headers = splitCSVLine(lines[i]).map((h) => h.toLowerCase());
      return { headerRowIndex: i, headers };
    }
  }
  return { headerRowIndex: -1, headers: [] };
}

// ─── Row validator / self-healer ─────────────────────────────────────────────

const SELF_HEAL_TOLERANCE = 0.5; // Allow ≤50% difference before rejecting CSV total

/**
 * Resolve the total cost for a row, using the self-healing heuristic.
 *
 * If the CSV-reported total is within `SELF_HEAL_TOLERANCE` of the
 * calculated total (unitCost × qty), trust the CSV value.  Otherwise
 * fall back to the calculated value.
 *
 * @param {number} unitCost    - Unit cost of the part.
 * @param {number} qty         - Quantity.
 * @param {number} csvTotal    - Total as reported in the CSV (may be 0).
 * @returns {number} Resolved total cost.
 */
export function resolveTotalCost(unitCost, qty, csvTotal) {
  const calculated = unitCost * qty;
  if (csvTotal > 0.01 && calculated > 0) {
    const diff = Math.abs(csvTotal - calculated) / calculated;
    if (diff < SELF_HEAL_TOLERANCE) return csvTotal;
  }
  return calculated;
}

/**
 * Resolve the total retail for a row (same self-healing logic as cost).
 *
 * @param {number} unitRetail  - Unit retail price.
 * @param {number} qty         - Quantity.
 * @param {number} csvTotal    - Total as reported in the CSV (may be 0).
 * @returns {number} Resolved total retail.
 */
export function resolveTotalRetail(unitRetail, qty, csvTotal) {
  const calculated = unitRetail * qty;
  if (csvTotal > 0.01 && calculated > 0) {
    const diff = Math.abs(csvTotal - calculated) / calculated;
    if (diff < SELF_HEAL_TOLERANCE) return csvTotal;
  }
  return calculated;
}

// ─── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse a CSV text string into an array of auto-parts rows.
 *
 * @param {string} csvText - Raw CSV content (may include BOM).
 * @returns {ParseResult} Parsed parts and diagnostics.
 */
export function parseCSV(csvText) {
  // Strip UTF-8 BOM
  const text = csvText.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  // Locate header row
  const { headerRowIndex, headers } = findHeaderRow(lines);
  if (headerRowIndex === -1) {
    return {
      parts: [],
      skippedCount: 0,
      error:
        'Could not find a valid header row (looking for "Cost", "Price", or "Qty"). Please check your CSV.',
    };
  }

  // Identify relevant column indices
  const costIdx = findColumnIndex(headers, COST_MATCHERS);
  const retailIdx = findColumnIndex(headers, RETAIL_MATCHERS);
  const qtyIdx = findColumnIndex(headers, QTY_MATCHERS);
  const totalCostIdx = findColumnIndex(headers, TOTAL_COST_MATCHERS);
  const totalRetailIdx = findColumnIndex(headers, TOTAL_RETAIL_MATCHERS);

  if (costIdx === -1) {
    return {
      parts: [],
      skippedCount: 0,
      error:
        'Could not find a "Unit Cost" or "Buy Price" column. Please ensure your file has cost data.',
    };
  }

  const requiredColumns =
    Math.max(
      costIdx,
      retailIdx !== -1 ? retailIdx : 0,
      qtyIdx !== -1 ? qtyIdx : 0,
      totalCostIdx !== -1 ? totalCostIdx : 0,
      totalRetailIdx !== -1 ? totalRetailIdx : 0,
    ) + 1;

  const parts = [];
  let skippedCount = 0;

  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const fields = splitCSVLine(lines[i]);

    // Skip completely empty rows
    if (!fields.length || fields.every((f) => !f)) {
      skippedCount++;
      continue;
    }

    // Skip rows with too few columns
    if (fields.length < requiredColumns) {
      skippedCount++;
      continue;
    }

    const unitCost = parseCurrency(fields[costIdx]);
    const unitRetail = retailIdx !== -1 ? parseCurrency(fields[retailIdx]) : 0;
    const qty = qtyIdx !== -1 ? parseCurrency(fields[qtyIdx]) : 1;

    const csvTotalCost = totalCostIdx !== -1 ? parseCurrency(fields[totalCostIdx]) : 0;
    const csvTotalRetail =
      totalRetailIdx !== -1 ? parseCurrency(fields[totalRetailIdx]) : 0;

    const totalCost = resolveTotalCost(unitCost, qty, csvTotalCost);
    const totalRetail = resolveTotalRetail(unitRetail, qty, csvTotalRetail);

    // Skip zero-cost items (warranties, free samples, etc.)
    if (unitCost <= 0) {
      skippedCount++;
      continue;
    }

    parts.push({ unitCost, unitRetail, qty, totalCost, totalRetail });
  }

  if (!parts.length) {
    return {
      parts: [],
      skippedCount,
      error:
        'No valid parts data found. Please check your CSV format. Make sure you have a "Unit Cost" column with numeric values.',
    };
  }

  return { parts, skippedCount, error: null };
}
