/**
 * CSV parser for auto-parts sales data.
 *
 * Handles real-world CSV quirks commonly found in POS system exports:
 *  - UTF-8 BOM stripping
 *  - Windows-style \r\n line endings
 *  - Auto-detected delimiter (comma, semicolon, tab, pipe) for European, TSV
 *    and legacy ERP (SAP, Oracle EBS) exports
 *  - Quoted fields containing the delimiter (e.g. "Smith, John")
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
 * @typedef {Object} SkipBreakdown
 * @property {number} blank    - Rows that were empty or whitespace-only after splitting.
 * @property {number} shortRow - Rows with fewer columns than the header requires.
 * @property {number} zeroCost - Rows skipped because unit cost was ≤ 0 (warranties, samples).
 */

/**
 * @typedef {Object} ParseResult
 * @property {ParsedPart[]}  parts        - Successfully parsed rows.
 * @property {number}        skippedCount - Total rows skipped (sum of all breakdown counts).
 * @property {SkipBreakdown} skipped      - Per-reason skip counts for user-facing diagnostics.
 * @property {string|null}   error        - Fatal error message, or null on success.
 */

function emptySkipBreakdown() {
  return { blank: 0, shortRow: 0, zeroCost: 0 };
}

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

// ─── Delimiter detection ─────────────────────────────────────────────────────

const SUPPORTED_DELIMITERS = [',', ';', '\t', '|'];

/**
 * Count occurrences of `delim` in `line` that fall OUTSIDE quoted fields.
 *
 * Without this, a semicolon-delimited row whose description field contains
 * commas (e.g. `Filter;"Premium, OEM-spec, fits 1.6L";10`) would inflate the
 * comma tally and trip the delimiter heuristic into picking `,`.
 *
 * @param {string} line - Single CSV line.
 * @param {string} delim - Candidate delimiter character.
 * @returns {number} Count of delimiters appearing outside double-quoted spans.
 */
function countDelimitersOutsideQuotes(line, delim) {
  let count = 0;
  let insideQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === delim && !insideQuotes) {
      count++;
    }
  }
  return count;
}

/**
 * Auto-detect the field delimiter used in a CSV/TSV body.
 *
 * Many European POS systems export with `;` (because the decimal comma
 * conflicts with `,` as a field separator), ERP exports sometimes use
 * tab-separated values, and legacy SAP / Oracle EBS exports default to
 * pipe (`|`). We pick the candidate with the highest total occurrence
 * count across the first 10 non-empty lines — ignoring any occurrences
 * that appear inside quoted fields — and fall back to comma when no
 * delimiter is present.
 *
 * @param {string} text - Raw CSV text (BOM already stripped).
 * @returns {string} One of ',', ';', '\t' or '|'.
 */
export function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ',';
  let bestCount = 0;
  for (const delim of SUPPORTED_DELIMITERS) {
    const count = sample.reduce(
      (sum, line) => sum + countDelimitersOutsideQuotes(line, delim),
      0,
    );
    if (count > bestCount) {
      bestCount = count;
      best = delim;
    }
  }
  return best;
}

// ─── RFC 4180 field splitter ─────────────────────────────────────────────────

/**
 * Split a single CSV line into fields, respecting RFC 4180 quoting rules.
 *
 * Handles:
 *  - Quoted fields containing the delimiter
 *  - Escaped double-quotes ("")
 *  - Trailing delimiter (empty last field)
 *
 * @param {string} line - Raw CSV line.
 * @param {string} [delimiter=','] - Field delimiter character.
 * @returns {string[]} Array of unquoted field values (whitespace-trimmed).
 */
export function splitCSVLine(line, delimiter = ',') {
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
    } else if (char === delimiter && !insideQuotes) {
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

/**
 * Scan the first `maxLines` rows to find the header row.
 *
 * Tokenises each candidate line and accepts it only when at least one field
 * matches one of the column matchers above. Substring-on-whole-line matching
 * would also flag narrative junk lines like `Note: prices include cost of
 * shipping` as headers, then mis-parse the next row as data.
 *
 * Returns the header row index and the lowercase token array, or
 * `{ headerRowIndex: -1, headers: [] }` if no header is found.
 *
 * @param {string[]} lines - All non-empty lines from the CSV.
 * @param {number}   [maxLines=10] - Maximum number of lines to scan.
 * @param {string}   [delimiter=','] - Field delimiter character.
 * @returns {{ headerRowIndex: number, headers: string[] }}
 */
export function findHeaderRow(lines, maxLines = 10, delimiter = ',') {
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const headers = splitCSVLine(lines[i], delimiter).map((h) => h.toLowerCase());
    if (headers.length < 2) continue;
    const looksLikeHeader =
      findColumnIndex(headers, COST_MATCHERS) !== -1 ||
      findColumnIndex(headers, RETAIL_MATCHERS) !== -1 ||
      findColumnIndex(headers, QTY_MATCHERS) !== -1 ||
      findColumnIndex(headers, TOTAL_COST_MATCHERS) !== -1 ||
      findColumnIndex(headers, TOTAL_RETAIL_MATCHERS) !== -1;
    if (looksLikeHeader) return { headerRowIndex: i, headers };
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
 * Non-string input (null, undefined, a File, an ArrayBuffer, etc.) returns a
 * clean error result rather than throwing \u2014 the upload path is downstream of a
 * FileReader whose `result` field is only weakly typed, and a thrown TypeError
 * inside `onload` is hard to surface to the user.
 *
 * @param {string} csvText - Raw CSV content (may include BOM).
 * @returns {ParseResult} Parsed parts and diagnostics.
 */
export function parseCSV(csvText) {
  if (typeof csvText !== 'string') {
    const received = csvText === null ? 'null' : typeof csvText;
    return {
      parts: [],
      skippedCount: 0,
      skipped: emptySkipBreakdown(),
      error: `Expected CSV text as a string, received ${received}.`,
    };
  }

  // Strip UTF-8 BOM
  const text = csvText.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  // Auto-detect delimiter (comma, semicolon, or tab) and locate header row
  const delimiter = detectDelimiter(text);
  const { headerRowIndex, headers } = findHeaderRow(lines, 10, delimiter);
  if (headerRowIndex === -1) {
    return {
      parts: [],
      skippedCount: 0,
      skipped: emptySkipBreakdown(),
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
      skipped: emptySkipBreakdown(),
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
  const skipped = emptySkipBreakdown();

  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const fields = splitCSVLine(lines[i], delimiter);

    // Skip completely empty rows
    if (!fields.length || fields.every((f) => !f)) {
      skipped.blank++;
      continue;
    }

    // Skip rows with too few columns
    if (fields.length < requiredColumns) {
      skipped.shortRow++;
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
      skipped.zeroCost++;
      continue;
    }

    parts.push({ unitCost, unitRetail, qty, totalCost, totalRetail });
  }

  const skippedCount = skipped.blank + skipped.shortRow + skipped.zeroCost;

  if (!parts.length) {
    return {
      parts: [],
      skippedCount,
      skipped,
      error:
        'No valid parts data found. Please check your CSV format. Make sure you have a "Unit Cost" column with numeric values.',
    };
  }

  return { parts, skippedCount, skipped, error: null };
}
