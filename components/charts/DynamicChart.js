import {
  BarChart,
  DonutChart,
  LineChart,
  AreaChart,
  ScatterChart,
  ComposedDualChart,
  RadarUIChart,
  TreemapChart,
  RadialBarChart,
  HorizontalBarChart,
  WaterfallChart,
  FunnelChartView,
  BubbleChart,
  RibbonChart,
  GaugeChart,
  CardVisual,
  MultiRowCardVisual,
  KpiVisual,
  TableVisual,
  MatrixVisual,
  GeoMap,
} from './index';
import { pivotSeries } from '../../lib/chartSeries';
import { MAX_SERIES, foldToOther } from '../../lib/chartPalette';
import { resolveChart } from '../../lib/chartResolver';

// DynamicChart is the final render gate for both the live storyboard and the PDF
// report. It delegates every type/axis decision to the shared resolver — the same
// function the backend uses — so the rendered chart can never disagree with the
// persisted spec, and any unsuitable type (from AI output or manual cycling) is
// downgraded to something the data supports.
export default function DynamicChart({
  data,
  type,
  xKey,
  yKey,
  secondaryYKey,
  xLabel,
  yLabel,
  compact = false,
  // Extra keys some visuals need: a third measure for a bubble's size, a second
  // dimension for a ribbon's series or a matrix's columns, and an explicit
  // target for a gauge or KPI.
  sizeKey = null,
  seriesKey = null,
  seriesSort = 'value-desc',
  target = null,
}) {
  if (!data || data.length === 0) return null;

  const { type: finalType, xKey: x, yKey: y, secondaryKey } = resolveChart(data, {
    type,
    xKey,
    yKey,
    secondaryYKey,
  });

  const axes = { xLabel, yLabel, compact };

  /**
   * A share-of-a-whole chart gets at most as many slices as there are colours.
   *
   * These are the forms where every mark takes its own colour, so a twelfth
   * slice used to be drawn in the same colour as the fourth. Dropping the tail
   * would change what the chart says the total is, so it is folded into one
   * "Other" instead — which is both readable and still adds up.
   */
  const SHARE_TYPES = new Set(['pie', 'donut', 'treemap', 'radial', 'multicard']);
  const rows = SHARE_TYPES.has(finalType) ? foldToOther(data, x, y, MAX_SERIES) : data;

  /**
   * A legend column turns one row per category into one row per category per
   * series, which is the shape a GROUP BY returns and not the shape a chart
   * draws. Only the types that can draw grouped series fold it — a ribbon and
   * a matrix read the long rows themselves.
   */
  const SPLITTABLE = new Set(['bar', 'hbar', 'line', 'area']);
  if (seriesKey && SPLITTABLE.has(finalType) && seriesKey !== x) {
    const { data: wide, keys } = pivotSeries(data, {
      xKey: x,
      seriesKey,
      yKey: y,
      sort: seriesSort,
    });
    if (keys.length > 1) {
      const props = { data: wide, xKey: x, yKey: y, seriesKeys: keys, ...axes };
      if (finalType === 'bar') return <BarChart {...props} />;
      if (finalType === 'hbar') return <HorizontalBarChart {...props} />;
      if (finalType === 'line') return <LineChart {...props} />;
      return <AreaChart {...props} />;
    }
  }

  switch (finalType) {
    // Maps take a region name on the x axis and a measure on the y, exactly
    // like a bar chart — only the drawing differs.
    case 'filledmap':
      return <GeoMap data={data} xKey={x} yKey={y} variant="filled" xLabel={xLabel} yLabel={yLabel} />;
    case 'bubblemap':
      return <GeoMap data={data} xKey={x} yKey={y} variant="bubble" xLabel={xLabel} yLabel={yLabel} />;
    case 'shapemap':
      return <GeoMap data={data} xKey={x} yKey={y} variant="shape" xLabel={xLabel} yLabel={yLabel} />;
    case 'hbar':
      return <HorizontalBarChart data={data} xKey={x} yKey={y} {...axes} />;
    case 'waterfall':
      return <WaterfallChart data={data} xKey={x} yKey={y} {...axes} />;
    case 'funnel':
      return <FunnelChartView data={data} xKey={x} yKey={y} />;
    case 'bubble':
      return (
        <BubbleChart
          data={data}
          xKey={x}
          yKey={y}
          sizeKey={sizeKey || secondaryKey || secondaryYKey}
          labelKey={xKey}
          {...axes}
        />
      );
    case 'ribbon':
      return (
        <RibbonChart data={data} xKey={x} yKey={y} seriesKey={seriesKey || secondaryKey} xLabel={xLabel} yLabel={yLabel} />
      );
    case 'gauge':
      return <GaugeChart data={data} xKey={x} yKey={y} target={target} />;
    case 'pie':
      return <DonutChart data={rows} nameKey={x} valueKey={y} variant="pie" compact={compact} />;
    case 'card':
      return <CardVisual data={data} xKey={x} yKey={y} label={yLabel} />;
    case 'multicard':
      return <MultiRowCardVisual data={data} xKey={x} yKey={y} />;
    case 'kpi':
      return <KpiVisual data={data} xKey={x} yKey={y} target={target} />;
    case 'table':
      return <TableVisual data={data} />;
    case 'matrix':
      return <MatrixVisual data={data} xKey={x} yKey={y} columnKey={seriesKey || secondaryKey} />;
    case 'radial':
      return <RadialBarChart data={rows} nameKey={x} valueKey={y} compact={compact} />;
    case 'scatter':
      return <ScatterChart data={data} xKey={x} yKey={y} xLabel={xLabel} yLabel={yLabel} compact={compact} />;
    case 'composed':
      return (
        <ComposedDualChart
          data={data}
          xKey={x}
          yKey={y}
          lineKey={secondaryKey || secondaryYKey}
          xLabel={xLabel}
          yLabel={yLabel}
          compact={compact}
        />
      );
    case 'radar':
      return <RadarUIChart data={data} nameKey={x} compact={compact} />;
    case 'treemap':
      return <TreemapChart data={rows} nameKey={x} dataKey={y} />;
    case 'line':
      return <LineChart data={data} xKey={x} yKey={y} xLabel={xLabel} yLabel={yLabel} compact={compact} />;
    case 'area':
      return <AreaChart data={data} xKey={x} yKey={y} xLabel={xLabel} yLabel={yLabel} compact={compact} />;
    case 'donut':
      return <DonutChart data={rows} nameKey={x} valueKey={y} compact={compact} />;
    case 'bar':
    default:
      return <BarChart data={data} xKey={x} yKey={y} xLabel={xLabel} yLabel={yLabel} compact={compact} />;
  }
}
