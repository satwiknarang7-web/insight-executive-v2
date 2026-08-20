/**
 * Deterministic JSON-to-CSV Export Utility
 * Ensures proper string escaping and quote-wrapping for enterprise datasets.
 */
export const downloadCleanedCSV = (data, filename = 'sanitized_dataset.csv') => {
  if (!data || !data.length) return;

  // Extract headers with proper escaping (same as values)
  const headers = Object.keys(data[0]).map(h => `"${String(h).replace(/"/g, '""')}"`).join(',');

  // Map rows and escape strings to handle internal commas
  const csvRows = data.map(row => {
    return Object.values(row).map(value => {
      const stringValue = value === null || value === undefined ? '' : String(value);
      // Escape double quotes by doubling them and wrapping in quotes
      return `"${stringValue.replace(/"/g, '""')}"`; 
    }).join(',');
  });

  const csvString = [headers, ...csvRows].join('\n');

  // Create and trigger download
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  
  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
