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
import { resolveChart } from '../../lib/chartResolver';

// DynamicChart is the final render gate for both the live storyboard and the PDF
// report. It delegates every type/axis decision to the shared resolver — the same
// function the backend uses — so the rendered chart can never disagree with the
// persisted spec, and any unsuitable type (from AI output or manual cycling) is
// downgraded to something the data supports.
export default function DynamicChart({ data, type, xKey, yKey, secondaryYKey }) {
  if (!data || data.length === 0) return null;

  const { type: finalType, xKey: x, yKey: y, secondaryKey } = resolveChart(data, {
    type,
    xKey,
    yKey,
    secondaryYKey,
  });

  switch (finalType) {
    case 'radial':
      return <RadialBarChart data={data} nameKey={x} valueKey={y} />;
    case 'scatter':
      return <ScatterChart data={data} xKey={x} yKey={y} />;
    case 'composed':
      return <ComposedDualChart data={data} xKey={x} yKey={y} lineKey={secondaryKey || secondaryYKey} />;
    case 'radar':
      return <RadarUIChart data={data} nameKey={x} />;
    case 'treemap':
      return <TreemapChart data={data} nameKey={x} dataKey={y} />;
    case 'line':
      return <LineChart data={data} xKey={x} yKey={y} />;
    case 'area':
      return <AreaChart data={data} xKey={x} yKey={y} />;
    case 'donut':
      return <DonutChart data={data} nameKey={x} valueKey={y} />;
    case 'bar':
    default:
      return <BarChart data={data} xKey={x} yKey={y} />;
  }
}
