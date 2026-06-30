/**
 * Security utilities for file-upload validation and exported-output sanitization.
 *
 * Guards two classes of injection risk:
 *
 * 1. Newline injection — a user-supplied file name containing CR or LF
 *    characters would split header lines in exported text and CSV reports,
 *    producing misleading or structurally broken output.
 *
 * 2. CSV formula injection — spreadsheet applications (Excel, Google Sheets,
 *    LibreOffice Calc) evaluate cells whose first character is =, +, -, or @
 *    as formulas.  A value like +2.50 in the "Change" column triggers this
 *    even though the underlying number is harmless; guarding it future-proofs
 *    the export against values that originate closer to user input.
 */

/** Maximum accepted upload size. Larger files risk OOM in the browser tab. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Validate a File object before reading it into memory.
 *
 * @param {File} file
 * @returns {string|null} Human-readable error string, or null if the file is safe to read.
 */
export function validateUploadFile(file) {
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `File too large (${mb} MB). Maximum allowed size is 50 MB — try exporting a shorter date range from your POS system.`;
  }
  return null;
}

/**
 * Strip control characters from a user-supplied file name.
 *
 * ASCII control characters (0x00–0x1F) and DEL (0x7F) include CR, LF, and
 * tab.  Embedding them verbatim in an exported report or CSV comment row
 * would inject extra lines or corrupt the file structure.
 *
 * @param {string} name - Raw file name from an <input type="file"> element.
 * @returns {string} Cleaned name, or 'Uploaded CSV' if blank after stripping.
 */
export function sanitizeFileName(name) {
  if (typeof name !== 'string') return 'Uploaded CSV';
  const cleaned = name.replace(/[\x00-\x1F\x7F]/g, '').trim();
  return cleaned || 'Uploaded CSV';
}

/**
 * Escape a value for safe inclusion in a CSV cell.
 *
 * Prevents formula injection by prefixing cells that start with =, +, -, or @
 * with a single-quote — the convention recognised by Excel, Google Sheets, and
 * LibreOffice Calc to force literal-string interpretation.
 *
 * Also applies RFC 4180 quoting for values that contain a comma, double-quote,
 * or newline so the exported file remains valid CSV regardless of cell content.
 *
 * @param {string|number} value - Cell value to encode.
 * @returns {string} Safe CSV cell value ready to join into a row string.
 */
export function escapeCSVCell(value) {
  const str = String(value);
  // Prefix formula-triggering first characters with a single-quote.
  // The quote is consumed by the spreadsheet app as a "force string" flag
  // and is not shown in the rendered cell.
  if (/^[=+\-@\t\r\n]/.test(str)) {
    return "'" + str;
  }
  // RFC 4180: wrap fields that contain the delimiter, quotes, or newlines.
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
