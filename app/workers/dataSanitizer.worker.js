import Papa from 'papaparse';
import { sanitizeDataset } from '../utils/dataCleaner';

self.onmessage = async (e) => {
  const { file } = e.data;

  if (!file) {
    self.postMessage({ type: 'error', error: 'No file provided' });
    return;
  }

  self.postMessage({ type: 'log', message: `> Initiating secure ingestion for: ${file.name}` });
  self.postMessage({ type: 'log', message: `> File size: ${(file.size / 1024).toFixed(2)} KB` });

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      self.postMessage({ type: 'log', message: `> Parsing complete. Rows detected: ${results.data.length}` });
      self.postMessage({ type: 'status', stage: 'Parsing', progress: 100 });

      const { cleanedData, metrics } = sanitizeDataset(results.data, (progress) => {
        self.postMessage({ 
          type: 'status', 
          stage: progress.stage, 
          progress: Math.round((progress.rowsProcessed / progress.totalRows) * 100) 
        });
        
        if (progress.rowsProcessed % 1000 === 0) {
          self.postMessage({ 
            type: 'log', 
            message: `> Sanitizing... ${progress.rowsProcessed}/${progress.totalRows} rows processed.` 
          });
        }
      });

      self.postMessage({ type: 'log', message: `> Sanitization complete.` });
      self.postMessage({ type: 'log', message: `> Redacted ${metrics.redactedPII} PII entities.` });
      self.postMessage({ type: 'log', message: `> Coerced ${metrics.anomalies} data anomalies.` });
      self.postMessage({ type: 'log', message: `> Flagged ${metrics.outliersCount} statistical outliers (|Z| > 3).` });
      self.postMessage({ type: 'log', message: `> Final dataset: ${cleanedData.length} records.` });

      self.postMessage({ 
        type: 'complete', 
        data: cleanedData, 
        metrics: metrics 
      });
    },
    error: (error) => {
      self.postMessage({ type: 'error', error: error.message });
    }
  });
};
