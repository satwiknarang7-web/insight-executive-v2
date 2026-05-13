import { 
  BarChart, 
  DonutChart, 
  LineChart, 
  AreaChart, 
  ScatterChart, 
  ComposedDualChart, 
  RadarUIChart, 
  TreemapChart,
  RadialBarChart
} from './index';

function inferChartType(data, xKey, yKey, secondaryYKey) {
  if (!data || data.length === 0) return 'bar';
  
  const sample = data[0];
  const keys = Object.keys(sample);
  const rowCount = data.length;
  const numericKeys = keys.filter(k => typeof sample[k] === 'number' && k !== xKey);
  
  // Check if xKey is a time/date column
  const isTimeValue = (val) => {
    if (typeof val === 'number') return false;
    const lower = String(val || '').toLowerCase();
    return (
      lower.includes('/') || 
      lower.includes('-') || 
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(lower) ||
      /^(q[1-4]|20\d{2})/.test(lower) ||
      lower.includes('year') ||
      lower.includes('month') ||
      lower.includes('day')
    );
  };

  const hasTimeX = isTimeValue(sample[xKey]);

  // HIGH PRIORITY: Dual Axis / Multi-Metric
  if (secondaryYKey || numericKeys.length >= 2) {
    if (hasTimeX) return 'composed';
    if (rowCount <= 8 && numericKeys.length >= 3) return 'radar';
    return 'scatter';
  }

  // HIGH DENSITY: Treemap
  if (rowCount > 12 && !hasTimeX) {
    return 'treemap';
  }

  // TIME SERIES: Area vs Line
  if (hasTimeX) {
    return rowCount > 12 ? 'area' : 'line';
  }

  // COMPOSITION: Radial vs Donut
  if (rowCount <= 5) {
    return 'radial';
  }
  
  if (rowCount <= 10) {
    return 'donut';
  }

  // FALLBACK
  return 'bar';
}

export default function DynamicChart({ data, type, xKey, yKey, secondaryYKey }) {
  if (!data || data.length === 0) return null;

  let normalizedType = type?.toLowerCase() || 'auto';

  if (normalizedType === 'auto' || !normalizedType) {
    normalizedType = inferChartType(data, xKey, yKey, secondaryYKey);
  }

  // Robust fuzzy matching for AI-generated chart types
  if (normalizedType.includes('radial')) {
    return <RadialBarChart data={data} nameKey={xKey} valueKey={yKey} />;
  }
  if (normalizedType.includes('scatter') || normalizedType.includes('distribution') || normalizedType.includes('correlation')) {
    return <ScatterChart data={data} xKey={xKey} yKey={yKey} />;
  }
  if (normalizedType.includes('composed') || normalizedType.includes('dual') || normalizedType.includes('multi')) {
    return <ComposedDualChart data={data} xKey={xKey} yKey={yKey} lineKey={secondaryYKey} />;
  }
  if (normalizedType.includes('radar')) {
    return <RadarUIChart data={data} nameKey={xKey} />;
  }
  if (normalizedType.includes('treemap')) {
    return <TreemapChart data={data} nameKey={xKey} dataKey={yKey} />;
  }
  if (normalizedType.includes('line') || normalizedType.includes('trend')) {
    return <LineChart data={data} xKey={xKey} yKey={yKey} />;
  }
  if (normalizedType.includes('area') || normalizedType.includes('volume')) {
    return <AreaChart data={data} xKey={xKey} yKey={yKey} />;
  }
  if (normalizedType.includes('donut') || normalizedType.includes('pie') || normalizedType.includes('proportion')) {
    return <DonutChart data={data} nameKey={xKey} valueKey={yKey} />;
  }
  if (normalizedType.includes('bar') || normalizedType.includes('column')) {
    return <BarChart data={data} xKey={xKey} yKey={yKey} />;
  }

  // Final fallback to BarChart
  return <BarChart data={data} xKey={xKey} yKey={yKey} />;
}
