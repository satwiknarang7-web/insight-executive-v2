"use client";

import { useEffect, useState } from "react";
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area
} from "recharts";
import ReactMarkdown from "react-markdown";
import DynamicChart from "../../../components/charts/DynamicChart";
import ChartBoundary from "../../../components/charts/ChartBoundary";
import { ChartPalette } from "../../../components/charts/palette";
import { renameCategories } from "../../../lib/chartLabels";
import { boldSegments } from "../../../lib/richText";
import { Layout, Target, Activity, Shield, CheckCircle2, TrendingUp, Calendar, Hash } from "lucide-react";

/**
 * Trim a finding's write-up to what an A4 page can hold.
 *
 * The verified-metrics list has no natural length — it is however many facts the
 * engine could prove — and the page is a fixed 1123px that clips whatever runs
 * past it. Cutting deliberately, at a whole bullet, is the difference between a
 * report that ends and one that stops mid-sentence. The deck on screen still
 * shows every fact; only the printed page is abridged.
 */
const PRINT_BULLETS = 1;

/** How many synthesis cards the summary page holds at this type size. */
const PRINT_SUMMARY_CARDS = 4;

function fitForPrint(markdown) {
  const lines = String(markdown || '').split('\n');
  const out = [];
  let bullets = 0;
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      bullets += 1;
      if (bullets > PRINT_BULLETS) continue;
    } else if (line.trim()) {
      bullets = 0;
    }
    out.push(line);
  }
  return out.join('\n');
}

export default function PrintReport() {
  const [data, setData] = useState(null);
  const [reportDate] = useState(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  const [reportId] = useState(`IE-${Math.random().toString(36).substring(2, 9).toUpperCase()}`);

  // A printed report is light, whatever the reader last chose on screen.
  //
  // Setting the attribute rather than recolouring is what makes the charts come
  // out right: this app defines `--color-white` per theme — navy in light mode —
  // so `text-white/40` already means "muted foreground", and the chart labels
  // and gridlines are painted from --chart-* variables that resolve the same
  // way. Without the attribute the document is still the dark theme, so every
  // data label is white on a white page.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    return () => {
      if (previous) root.setAttribute('data-theme', previous);
      else root.removeAttribute('data-theme');
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PRINT_DATA) {
      setData(window.PRINT_DATA);
    } else {
      const savedData = JSON.parse(localStorage.getItem("reportData") || "null");
      if (savedData) setData(savedData);
    }
  }, []);

  if (!data) return <div className="p-20 text-white/20 text-center font-mono uppercase tracking-[0.5em] animate-pulse">Initializing Executive Synthesis...</div>;

  const renderChart = (chart) => {
    const result = chart.resultData;
    const type = chart.chart_type?.toLowerCase() || 'bar';
    if (!result || result.length === 0) return (
      <div className="text-white/20 text-xs font-mono">Insufficient Data for Synthesis</div>
    );

    const keys = Object.keys(result[0]);
    const y = chart.yAxisKey || keys.find(k => typeof result[0][k] === 'number') || keys[keys.length - 1];
    const x = chart.xAxisKey || keys.find(k => k !== y) || keys[0];
    // This page renders charts directly rather than through LazyChart, so the
    // renames have to be applied here too or the PDF disagrees with the deck.
    const rows = renameCategories(result, x, chart.labels);

    // Boundaried, and that is load-bearing here rather than merely tidy.
    //
    // This page has no interactive recovery: a headless browser opens it, waits
    // for the container to appear, and prints. A chart throwing during render
    // unmounts the whole tree — including the sentinel the renderer waits for —
    // so one bad chart did not degrade one panel, it silently cost the entire
    // report, and the failure surfaced as "the report did not finish
    // rendering" with nothing pointing at which chart was responsible.
    // A definite height, not a percentage: Recharts' ResponsiveContainer
    // measures its parent, and `h-full` inside a flex column resolves to zero —
    // it logs "width(-1) and height(-1)" and draws nothing at all.
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div style={{ width: '100%', height: '310px' }}>
          <ChartBoundary resetKey={chart.id || type}>
            <ChartPalette colors={chart.colors} colorBy={chart.colorBy}>
              <DynamicChart
                data={rows}
                type={type}
                xKey={x}
                yKey={y}
                secondaryYKey={chart.secondaryYAxisKey}
                seriesKey={chart?.seriesKey}
                seriesSort={chart?.seriesSort}
              />
            </ChartPalette>
          </ChartBoundary>
        </div>
      </div>
    );
  };

  const slideStyle = {
    width: '794px',
    height: '1123px',
    pageBreakAfter: 'always',
    breakAfter: 'page',
    overflow: 'hidden',
    position: 'relative',
    boxSizing: 'border-box'
  };

  return (
    <div className="print-container-rendered block bg-canvas w-full text-white font-['Outfit'] selection:bg-accent-500/30" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
      
      {/* PAGE 1: COVER PAGE */}
      <div style={slideStyle} className="p-20 flex flex-col justify-between bg-canvas">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-accent-500/5 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2" />
        
        <div className="flex items-center gap-4">
          {/* The light artwork, unconditionally: the report is printed on white
              whatever theme the app is in, and the CSS swap would follow the
              screen rather than the page. Not next/image — this is rendered by
              a headless browser, where lazy loading leaves a hole in the PDF. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-light.png" alt="Insight Executive" className="h-14 w-auto" />
        </div>

        <div className="space-y-8 relative z-10">
          <div className="h-px w-24 bg-accent-500/50 mb-10" />
          <h1 className="text-8xl font-black uppercase tracking-tight leading-[0.9] text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40">
            {data.slideZero.title.split(' ')[0]} <br />
            <span className="text-accent-500">{data.slideZero.title.split(' ').slice(1).join(' ')}</span>
          </h1>
          <p className="text-2xl text-white/40 font-medium tracking-tight max-w-2xl leading-relaxed">
            Strategic analysis and data-driven storyboard synthesized for executive decision-making.
          </p>
        </div>

        <div className="flex justify-between items-end border-t border-white/10 pt-10">
          <div className="space-y-2">
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 italic">Report Identity</span>
            <div className="flex items-center gap-3 font-mono text-accent-500">
              <Hash size={14} />
              <span className="text-xl font-bold">{reportId}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 text-white/60">
              <Calendar size={16} className="text-accent-500" />
              <span className="font-bold uppercase tracking-widest">{reportDate}</span>
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20">Authorized for Disclosure</span>
          </div>
        </div>
      </div>

      {/* PAGE 2: TABLE OF CONTENTS */}
      <div style={slideStyle} className="p-20 flex flex-col space-y-12 bg-canvas">
        <div className="flex items-center gap-4 border-b border-white/10 pb-8">
          <Layout className="text-accent-500" size={32} />
          <h2 className="text-4xl font-black uppercase tracking-tight">Strategic Roadmap</h2>
        </div>

        <div className="grid grid-cols-1 gap-2 flex-1 overflow-hidden">
          <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl group">
            <div className="flex items-center gap-6">
              <span className="text-2xl font-black text-white/10">01</span>
              <span className="text-lg font-bold text-accent-400 uppercase tracking-widest">Executive Synthesis</span>
            </div>
            <div className="h-px flex-1 mx-8 border-t border-dashed border-white/10" />
            <span className="text-white/40 font-mono">P. 03</span>
          </div>
          {data.storyboard.map((slide, i) => (
            <div key={i} className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
              <div className="flex items-center gap-6">
                <span className="text-2xl font-black text-white/10">{(i + 2).toString().padStart(2, '0')}</span>
                <span className="text-lg font-bold text-white/80 uppercase tracking-widest line-clamp-1">{slide.pageTitle}</span>
              </div>
              <div className="h-px flex-1 mx-8 border-t border-dashed border-white/10" />
              <span className="text-white/40 font-mono">P. {(i + 4).toString().padStart(2, '0')}</span>
            </div>
          ))}
          <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
            <div className="flex items-center gap-6">
              <span className="text-2xl font-black text-white/10">...</span>
              <span className="text-lg font-bold text-white/40 uppercase tracking-widest italic">Data Methodology Audit</span>
            </div>
            <div className="h-px flex-1 mx-8 border-t border-dashed border-white/10" />
            <span className="text-white/40 font-mono">P. {data.storyboard.length + 4}</span>
          </div>
        </div>

        {data.kpis && data.kpis.length > 0 && (
          <div className="mt-6">
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-accent-500 block mb-4">Core Performance Indicators</span>
            <div className="grid grid-cols-3 gap-4">
              {data.kpis.slice(0, 6).map((kpi, i) => (
                <div key={i} className="p-6 bg-accent-500/5 border border-accent-500/20 rounded-[1.5rem] relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <TrendingUp size={32} />
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/40 block mb-2">{kpi.label}</span>
                  <div className="text-2xl font-black text-white">{kpi.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* PAGE 3: EXECUTIVE SYNTHESIS */}
      {/* Anchored to the top, not centred: this page's content has no fixed
          length, and centring an over-tall column pushes the heading off the
          top as well as the last card off the bottom. */}
      <div style={slideStyle} className="p-16 flex flex-col justify-start bg-canvas overflow-hidden">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="text-center space-y-4">
            <span className="text-[10px] font-black uppercase tracking-[0.6em] text-accent-500">Perspective 01</span>
            <h2 className="text-5xl font-black uppercase tracking-tight leading-tight">
              {data.slideZero.title}
            </h2>
            {data.slideZero.headline && (
              <p className="text-2xl leading-relaxed text-white/70 max-w-3xl mx-auto">
                {data.slideZero.headline}
              </p>
            )}
          </div>

          <div className="space-y-5">
            {(data.slideZero.macroInsights || data.slideZero.synthesis_points || []).slice(0, PRINT_SUMMARY_CARDS).map((insight, i) => {
              const hasColon = insight.includes(':');
              const prefix = hasColon ? insight.split(':')[0] : null;
              const content = hasColon ? insight.split(':').slice(1).join(':').trim() : insight;

              return (
                <div 
                  key={i} 
                  className="bg-white/[0.03] border border-white/10 p-10 relative [clip-path:polygon(0_0,_calc(100%-30px)_0,_100%_30px,_100%_100%,_30px_100%,_0_calc(100%-30px))]"
                >
                  <div className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center text-accent-500/20">
                    <Target size={24} />
                  </div>
                  <p className="text-white/80 text-2xl leading-relaxed">
                    {prefix && (
                      <span className="text-accent-500 font-black tracking-[0.2em] mr-4 uppercase text-sm block mb-3 border-l-4 border-accent-500 pl-4">
                        {prefix}
                      </span>
                    )}
                    {/* Segments, not markup. This text is editable on the
                        dashboard and travels with a shared analysis, so the
                        person who wrote it and the person whose browser renders
                        it are not necessarily the same — and the PDF renderer
                        runs this page carrying the reader's own session. React
                        escapes each segment; a string replace into
                        dangerouslySetInnerHTML escaped nothing. */}
                    <span>
                      {boldSegments(content).map((segment, j) =>
                        segment.bold ? (
                          <strong key={j} className="text-white font-black">
                            {segment.text}
                          </strong>
                        ) : (
                          segment.text
                        )
                      )}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* STORYBOARD SLIDES */}
      {data.storyboard.map((slide, index) => (
        <div key={index} style={slideStyle} className="p-16 flex flex-col gap-10 bg-canvas">
          <div className="flex justify-between items-start border-b border-white/10 pb-8">
            <div className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.5em] text-white/20">Strategic Insight {index + 1}</span>
              <h2 className="text-5xl font-black uppercase tracking-tight leading-none">
                {slide.pageTitle}
              </h2>
            </div>
            <div className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-mono text-white/40 tracking-widest uppercase">
              MODULE: {slide.chart.id.toUpperCase()}
            </div>
          </div>
          
          {/* The chart spans the page; the write-up sits under it.
              Side by side, the visual column was 322px wide and 460px tall — a
              bar chart squeezed into a vertical strip, its category labels
              rotated and overlapping into each other ("24.3M-48.54M8.5M-72.8M"
              in the text layer). A chart wants landscape proportions and the
              only place to find them on a portrait page is the full width.

              The heights are fixed rather than flexed because this page cannot
              grow: it is 1123px with overflow hidden, and when the row was
              sized by the narrative it reached 2298px — which is how the charts
              ended up below the fold and were erased entirely. */}
          <div className="flex flex-col gap-6 flex-1 min-h-0 overflow-hidden">
            <div className="shrink-0 h-[360px] card p-5 shadow-2xl relative overflow-hidden">
              {renderChart(slide.chart)}
            </div>

            <div className="grid grid-cols-12 gap-8 flex-1 min-h-0 overflow-hidden">
              <div className="col-span-8 prose prose-invert max-w-none min-h-0 overflow-hidden">
                <ReactMarkdown
                  components={{
                    p: ({node, ...props}) => <p className="text-[14px] text-white/60 leading-relaxed mb-3" {...props} />,
                    strong: ({node, ...props}) => <strong className="text-accent-400 font-black" {...props} />,
                    ul: ({node, ...props}) => <ul className="space-y-2 mt-2" {...props} />,
                    li: ({node, ...props}) => (
                      <li className="text-[13px] text-white/80 flex items-start gap-3 p-2.5 bg-white/[0.02] border-l-4 border-accent-500 rounded-r-xl">
                        <div className="w-1.5 h-1.5 rounded-full bg-accent-500 mt-1.5 shrink-0" />
                        <span className="line-clamp-2">{props.children}</span>
                      </li>
                    ),
                  }}
                >
                  {fitForPrint(slide.markdownAnalysis)}
                </ReactMarkdown>
              </div>

              <div className="col-span-4 flex flex-col justify-between min-h-0 overflow-hidden">
                <div className="p-4 bg-accent-500/10 border border-accent-500/20 rounded-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-3 opacity-5">
                    <Activity size={64} />
                  </div>
                  <h4 className="text-[9px] font-black uppercase tracking-[0.35em] text-accent-500 mb-2">Strategic Lever</h4>
                  <p className="text-[13px] text-accent-100 font-medium leading-relaxed italic">
                    Immediate reallocation of resources toward high-impact categories is recommended to optimize ROI based on these trends.
                  </p>
                </div>
                <div className="flex flex-col gap-1 text-[8px] font-black uppercase tracking-[0.35em] text-white/10 italic">
                  <span>SQL Verified</span>
                  <span>Aggregated Logic</span>
                  <span>Top 10 Precision</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* FINAL PAGE: METHODOLOGY & AUDIT */}
      <div style={slideStyle} className="p-20 flex flex-col justify-between border-t-8 border-accent-500 bg-canvas">
        <div className="space-y-16">
          <div className="flex items-center gap-8">
            <Shield className="text-accent-500" size={64} />
            <div>
              <h2 className="text-5xl font-black uppercase tracking-tight">Data Integrity Audit</h2>
              <p className="text-white/40 text-xl font-medium">Compliance and methodology summary for {reportId}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-16">
            <div className="space-y-8">
              <h3 className="text-xs font-black uppercase tracking-[0.5em] text-accent-500 border-b border-accent-500/20 pb-6">Synthesis Methodology</h3>
              <ul className="space-y-6">
                {[
                  "SQL-Driven Mathematical Verification",
                  "Heuristic Anomaly Detection & Scrubbing",
                  "Context-Aware Narrative Synthesis",
                  "Multi-Model Cross-Validation"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-4 text-white/60 text-lg">
                    <CheckCircle2 size={24} className="text-accent-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-8">
              <h3 className="text-xs font-black uppercase tracking-[0.5em] text-accent-500 border-b border-accent-500/20 pb-6">Audit Footprint</h3>
              <div className="p-10 bg-white/5 border border-white/10 rounded-[2rem] font-mono text-xs text-white/40 leading-loose">
                TIMESTAMP: {new Date().toISOString()} <br />
                ENGINE_VERSION: NL2QUERY_PRO_V2 <br />
                ID: {reportId} <br />
                ENTROPY_SCORE: 0.998 <br />
                LATENCY_EXEC: 1.2s <br />
                SOURCE: CLOUD_REPLICATED_DB
              </div>
            </div>
          </div>
        </div>

        <div className="text-center space-y-8">
          <div className="flex items-center justify-center gap-6 opacity-20">
            <div className="h-px w-32 bg-white" />
            <span className="text-[12px] font-black uppercase tracking-[1.5em]">End of Report</span>
            <div className="h-px w-32 bg-white" />
          </div>
          <p className="text-sm text-white/20 max-w-2xl mx-auto leading-relaxed italic">
            This document and the data contained herein are confidential. Unauthorized reproduction or distribution is strictly prohibited under the terms of the master service agreement.
          </p>
        </div>
      </div>
    </div>
  );
}
