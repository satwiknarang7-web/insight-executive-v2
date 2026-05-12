import { 
  BarChart, 
  DonutChart, 
  LineChart, 
  AreaChart, 
  ScatterChart, 
  ComposedDualChart, 
  RadarUIChart, 
  TreemapChart 
} from './index';

export default function DynamicChart({ data, type, xKey, yKey, secondaryYKey }) {
  if (!data || data.length === 0) return null;

  const normalizedType = type?.toLowerCase() || '';

  // Robust fuzzy matching for AI-generated chart types
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
