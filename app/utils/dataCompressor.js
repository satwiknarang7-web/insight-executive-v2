/**
 * Data Compression Layer for LLM context windows.
 * Reduces raw datasets into high-density statistical metadata.
 * Includes median, stddev, percentiles, and top-N categoricals for rich AI context.
 */
export const generateDatasetSummary = (data) => {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return { error: "No data loaded or empty dataset" };
  }

  try {
    const total_records = data.length;
    const keys = Object.keys(data[0] || {});
    
    const numeric_aggregations = {};
    const categorical_insights = {};

    keys.forEach(key => {
      // Check if the column is primarily numeric
      const values = data.map(row => row[key]).filter(v => v !== null && v !== undefined && v !== "");
      
      if (values.length === 0) return;

      const numericValues = values.map(v => Number(v)).filter(v => !isNaN(v));

      // If more than 80% of non-empty values are numeric, treat as numeric
      if (numericValues.length > 0 && (numericValues.length / values.length) > 0.8) {
        // Sort for percentile calculations
        const sorted = [...numericValues].sort((a, b) => a - b);
        const n = sorted.length;
        
        let sum = 0;
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < n; i++) {
          const v = sorted[i];
          if (v < min) min = v;
          if (v > max) max = v;
          sum += v;
        }
        
        const avg = sum / n;
        const median = n % 2 === 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
        const p25 = sorted[Math.floor(n * 0.25)];
        const p75 = sorted[Math.floor(n * 0.75)];
        
        // Standard deviation
        let sumSqDiff = 0;
        for (let i = 0; i < n; i++) {
          sumSqDiff += (sorted[i] - avg) ** 2;
        }
        const stddev = Math.sqrt(sumSqDiff / n);

        numeric_aggregations[key] = {
          avg: Number(avg.toFixed(2)),
          median: Number(median.toFixed(2)),
          max: max === -Infinity ? 0 : max,
          min: min === Infinity ? 0 : min,
          stddev: Number(stddev.toFixed(2)),
          p25: Number(p25.toFixed(2)),
          p75: Number(p75.toFixed(2)),
          count: n
        };
      } else {
        // Categorical Insight (Top-N frequent with counts)
        const frequencyMap = {};
        values.forEach(v => {
          frequencyMap[v] = (frequencyMap[v] || 0) + 1;
        });
        
        const sortedCategories = Object.entries(frequencyMap).sort((a, b) => b[1] - a[1]);
        if (sortedCategories.length > 0) {
          categorical_insights[key] = {
            unique_count: sortedCategories.length,
            top_values: sortedCategories.slice(0, 5).map(([value, count]) => ({ value, count }))
          };
        }
      }
    });

    // Cap total serialized output to prevent token overflow
    const summary = {
      total_records,
      columns: keys,
      numeric_aggregations,
      categorical_insights
    };

    const serialized = JSON.stringify(summary);
    if (serialized.length > 4000) {
      // Trim top_values to top 3 and remove percentiles to fit budget
      Object.values(summary.categorical_insights).forEach(cat => {
        cat.top_values = cat.top_values.slice(0, 3);
      });
      Object.values(summary.numeric_aggregations).forEach(num => {
        delete num.p25;
        delete num.p75;
      });
    }

    return summary;
  } catch (err) {
    console.error("Compression Error:", err);
    return { error: "Failed to generate dataset summary", details: err.message };
  }
};
