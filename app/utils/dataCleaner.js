/**
 * Enterprise-Grade Data Sanitization Engine with PII Redaction
 */

export const cleanFloatingPoints = (text) => {
  if (!text) return text;
  // Matches numbers with a decimal point followed by 3 or more digits
  return text.replace(/\d+\.\d{3,}/g, (match) => {
    return parseFloat(match).toFixed(2);
  });
};

const PII_PATTERNS = {
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  PHONE: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  ID: /\b(?:\d{3}-\d{2}-\d{4}|\d{4}-\d{4}-\d{4}-\d{4})\b/g // SSN or Credit Card
};

export function sanitizeDataset(rawDataArray, onProgress = () => {}) {
  if (!Array.isArray(rawDataArray) || rawDataArray.length === 0) {
    return { cleanedData: [], metrics: { totalRows: 0, droppedRows: 0, anomalies: 0, redactedPII: 0, nullsFound: 0, typesCoerced: 0, totalCells: 0 } };
  }

  const columnNames = Object.keys(rawDataArray[0]);
  const metrics = {
    totalRows: rawDataArray.length,
    droppedRows: 0,
    anomalies: 0,
    redactedPII: 0,
    nullsFound: 0,
    typesCoerced: 0,
    totalCells: rawDataArray.length * columnNames.length,
    columnStats: columnNames.reduce((acc, col) => ({ 
      ...acc, 
      [col]: { type: 'unknown', nullCount: 0, distinctCount: 0, piiCount: 0 } 
    }), {})
  };

  const cleanedData = [];

  for (let i = 0; i < rawDataArray.length; i++) {
    if (i % 500 === 0) {
      onProgress({ 
        stage: 'Sanitizing & Redacting', 
        rowsProcessed: i, 
        totalRows: rawDataArray.length 
      });
    }

    const row = rawDataArray[i];
    const cleanedRow = {};

    for (const key of columnNames) {
      let val = row[key];
      const originalVal = val;

      // 1. PII Redaction
      if (typeof val === 'string') {
        let piiFound = false;
        if (PII_PATTERNS.EMAIL.test(val)) {
          val = val.replace(PII_PATTERNS.EMAIL, '[REDACTED_EMAIL]');
          piiFound = true;
        }
        PII_PATTERNS.EMAIL.lastIndex = 0;
        if (PII_PATTERNS.PHONE.test(val)) {
          val = val.replace(PII_PATTERNS.PHONE, '[REDACTED_PHONE]');
          piiFound = true;
        }
        PII_PATTERNS.PHONE.lastIndex = 0;
        if (PII_PATTERNS.ID.test(val)) {
          val = val.replace(PII_PATTERNS.ID, '[REDACTED_ID]');
          piiFound = true;
        }
        PII_PATTERNS.ID.lastIndex = 0;

        if (piiFound) {
          metrics.redactedPII++;
          metrics.columnStats[key].piiCount++;
        }
      }

      // 2. Type Coercion & Null Handling
      if (typeof val === 'string') {
        const trimmed = val.trim();
        const lowerVal = trimmed.toLowerCase();

        if (['', 'null', 'undefined', 'n/a', '-', 'none', 'nan'].includes(lowerVal)) {
          val = null;
          metrics.nullsFound++;
        } else if (isNumeric(trimmed)) {
          val = parseNumber(trimmed);
          metrics.typesCoerced++;
        } else if (isValidDate(trimmed)) {
          try {
            val = new Date(trimmed).toISOString();
            metrics.typesCoerced++;
          } catch (e) {}
        }
      } else if (val === null || val === undefined) {
        metrics.nullsFound++;
      }

      if (val === null) {
        metrics.columnStats[key].nullCount++;
      }

      cleanedRow[key] = val;
    }

    const nonNullValues = Object.values(cleanedRow).filter(v => v !== null && v !== undefined);
    if (nonNullValues.length === 0) {
      metrics.droppedRows++;
      continue;
    }

    cleanedData.push(cleanedRow);
  }

  // Column Type Inference
  columnNames.forEach(col => {
    const values = cleanedData.map(r => r[col]).filter(v => v !== null);
    if (values.length > 0) {
      const types = new Set(values.map(v => typeof v));
      if (types.size === 1) {
        metrics.columnStats[col].type = Array.from(types)[0];
      } else if (types.has('number') && types.has('string')) {
        metrics.columnStats[col].type = 'mixed';
      } else {
        metrics.columnStats[col].type = 'object';
      }
      metrics.columnStats[col].distinctCount = new Set(values).size;
    }
  });

  // Outlier Detection (|Z| > 2.5)
  metrics.outliersCount = 0;
  columnNames.forEach(col => {
    if (metrics.columnStats[col].type === 'number') {
      const values = cleanedData.map(r => r[col]).filter(v => v !== null);
      if (values.length > 5) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const stdDev = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length);
        
        if (stdDev > 0) {
          cleanedData.forEach(row => {
            if (row[col] !== null) {
              const zScore = (row[col] - mean) / stdDev;
              if (Math.abs(zScore) > 2.5) {
                row.isAnomaly = true;
                metrics.outliersCount++;
              }
            }
          });
        }
      }
    }
  });

  // Integrity Logic: Only count Outliers and Missing Values as "Anomalies"
  // Type coercion (string -> number) is a standard ETL process, not an integrity failure.
  metrics.totalAnomalies = metrics.nullsFound + metrics.outliersCount;
  
  return { cleanedData, metrics };
}


function isNumeric(str) {
  if (typeof str !== 'string') return false;
  const numericRegex = /^[\$€£¥]?\s?[\-+]?[0-9,]*\.?[0-9]+([eE][\-+]?[0-9]+)?%?$/;
  const accountingRegex = /^\([\$€£¥]?[0-9,]*\.?[0-9]+\)$/;
  return numericRegex.test(str) || accountingRegex.test(str);
}

function parseNumber(str) {
  let cleaned = str.replace(/[^\d.eE\-+()]/g, '');
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  const isPercentage = str.includes('%');
  let num = parseFloat(cleaned);
  if (isPercentage) num = num / 100;
  return isNaN(num) ? null : num;
}

function isValidDate(str) {
  if (typeof str !== 'string' || str.length < 5) return false;
  if (!str.includes('/') && !str.includes('-')) return false;
  const d = new Date(str);
  return d instanceof Date && !isNaN(d.getTime());
}
