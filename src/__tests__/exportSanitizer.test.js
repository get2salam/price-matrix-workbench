/**
 * Unit tests for src/utils/exportSanitizer.js
 */

import { describe, it, expect } from 'vitest';
import {
  validateUploadFile,
  sanitizeFileName,
  escapeCSVCell,
} from '../utils/exportSanitizer.js';

// ─── validateUploadFile ───────────────────────────────────────────────────────

describe('validateUploadFile', () => {
  function fakeFile(sizeBytes) {
    return { size: sizeBytes, name: 'data.csv', type: 'text/csv' };
  }

  it('accepts a typical small file', () => {
    expect(validateUploadFile(fakeFile(512 * 1024))).toBeNull(); // 512 KB
  });

  it('accepts a file exactly at the 50 MB limit', () => {
    expect(validateUploadFile(fakeFile(50 * 1024 * 1024))).toBeNull();
  });

  it('rejects a file one byte over the 50 MB limit', () => {
    const err = validateUploadFile(fakeFile(50 * 1024 * 1024 + 1));
    expect(err).not.toBeNull();
    expect(err).toMatch(/too large/i);
    expect(err).toMatch(/50 MB/);
  });

  it('includes the actual file size in MB in the error message', () => {
    const err = validateUploadFile(fakeFile(75 * 1024 * 1024));
    expect(err).toMatch(/75\.0 MB/);
  });

  it('mentions reducing the export date range as a recovery hint', () => {
    const err = validateUploadFile(fakeFile(100 * 1024 * 1024));
    expect(err).toMatch(/date range/i);
  });
});

// ─── sanitizeFileName ─────────────────────────────────────────────────────────

describe('sanitizeFileName', () => {
  it('passes through a normal file name unchanged', () => {
    expect(sanitizeFileName('parts-export-2026.csv')).toBe('parts-export-2026.csv');
  });

  it('strips LF that would inject a new line into an exported report', () => {
    // Attacker-crafted name: "data.csv\ninjected line"
    expect(sanitizeFileName('data.csv\ninjected line')).toBe('data.csvinjected line');
  });

  it('strips CR', () => {
    expect(sanitizeFileName('data\r.csv')).toBe('data.csv');
  });

  it('strips tab characters', () => {
    expect(sanitizeFileName('my\tfile.csv')).toBe('myfile.csv');
  });

  it('strips null bytes', () => {
    expect(sanitizeFileName('file\x00.csv')).toBe('file.csv');
  });

  it('strips all ASCII control characters 0x00–0x1F', () => {
    expect(sanitizeFileName('file\x01\x0B\x1F.csv')).toBe('file.csv');
  });

  it('strips the DEL character (0x7F)', () => {
    expect(sanitizeFileName('file\x7F.csv')).toBe('file.csv');
  });

  it('returns "Uploaded CSV" when the name is entirely control characters', () => {
    expect(sanitizeFileName('\n\r\t\x00')).toBe('Uploaded CSV');
  });

  it('returns "Uploaded CSV" for an empty string', () => {
    expect(sanitizeFileName('')).toBe('Uploaded CSV');
  });

  it('returns "Uploaded CSV" for non-string input', () => {
    expect(sanitizeFileName(null)).toBe('Uploaded CSV');
    expect(sanitizeFileName(undefined)).toBe('Uploaded CSV');
    expect(sanitizeFileName(42)).toBe('Uploaded CSV');
  });

  it('preserves Unicode file names that contain no control characters', () => {
    expect(sanitizeFileName('données-2026.csv')).toBe('données-2026.csv');
    expect(sanitizeFileName('部品データ.csv')).toBe('部品データ.csv');
  });
});

// ─── escapeCSVCell ────────────────────────────────────────────────────────────

describe('escapeCSVCell', () => {
  it('passes safe plain text through unchanged', () => {
    expect(escapeCSVCell('Maximum')).toBe('Maximum');
    expect(escapeCSVCell('2.50')).toBe('2.50');
    expect(escapeCSVCell('63.5%')).toBe('63.5%');
  });

  it('passes numeric input through after converting to string', () => {
    expect(escapeCSVCell(2.5)).toBe('2.5');
    expect(escapeCSVCell(0)).toBe('0');
  });

  it('prefixes "=" to prevent FORMULA injection', () => {
    expect(escapeCSVCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(escapeCSVCell('=HYPERLINK("http://evil.com","Click")')).toBe(
      "'=HYPERLINK(\"http://evil.com\",\"Click\")"
    );
  });

  it('prefixes "+" used in the Change column positive-change display', () => {
    // The exported CSV currently emits "+2.50" for positive multiplier changes;
    // Excel/Sheets evaluates this as a formula.
    expect(escapeCSVCell('+2.50')).toBe("'+2.50");
    expect(escapeCSVCell('+0.00')).toBe("'+0.00");
  });

  it('prefixes "-" to prevent negative-number formula trigger', () => {
    expect(escapeCSVCell('-1.25')).toBe("'-1.25");
  });

  it('prefixes "@" to prevent DDE / function injection', () => {
    expect(escapeCSVCell('@SUM(1+1)')).toBe("'@SUM(1+1)");
  });

  it('wraps values containing commas in double-quotes (RFC 4180)', () => {
    expect(escapeCSVCell('Smith, John')).toBe('"Smith, John"');
  });

  it('wraps and doubles embedded double-quotes (RFC 4180)', () => {
    expect(escapeCSVCell('say "hello"')).toBe('"say ""hello"""');
  });

  it('wraps values containing newlines', () => {
    expect(escapeCSVCell('line1\nline2')).toBe('"line1\nline2"');
  });
});
