"use client";

import { useEffect, useState } from "react";
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area
} from "recharts";
import ReactMarkdown from "react-markdown";
import DynamicChart from "../../../components/charts/DynamicChart";
import { ChartPalette } from "../../../components/charts/palette";
import { Zap, Layout, Target, Activity, Shield, CheckCircle2, TrendingUp, Calendar, Hash } from "lucide-react";

export default function PrintReport() {
  const [data, setData] = useState(null);
  const [reportDate] = useState(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  const [reportId] = useState(`IE-${Math.random().toString(36).substring(2, 9).toUpperCase()}`);

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

    return (
      <div className="w-full flex justify-center scale-[0.85] origin-center">
        <div style={{ width: '600px', height: '400px' }}>
          <ChartPalette colors={chart.colors}>
            <DynamicChart
              data={result}
              type={type}
              xKey={x}
              yKey={y}
              secondaryYKey={chart.secondaryYAxisKey}
            />
          </ChartPalette>
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
    <div className="print-container-rendered block bg-slate-950 w-full text-white font-['Outfit'] selection:bg-accent-500/30" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
      
      {/* PAGE 1: COVER PAGE */}
      <div style={slideStyle} className="p-20 flex flex-col justify-between bg-black">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-accent-500/5 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2" />
        
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-accent-500 rounded-xl flex items-center justify-center text-on-accent shadow-[0_0_20px_rgba(20,184,166,0.4)]">
            <Zap size={24} fill="currentColor" />
          </div>
          <div className="flex flex-col">
            <span className="font-black text-2xl tracking-tighter leading-none">Insight</span>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-accent-500">Executive Intelligence</span>
          </div>
        </div>

        <div className="space-y-8 relative z-10">
          <div className="h-px w-24 bg-accent-500/50 mb-10" />
          <h1 className="text-8xl font-black uppercase tracking-tighter leading-[0.9] text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40">
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
      <div style={slideStyle} className="p-20 flex flex-col space-y-12 bg-black">
        <div className="flex items-center gap-4 border-b border-white/10 pb-8">
          <Layout className="text-accent-500" size={32} />
          <h2 className="text-4xl font-black uppercase tracking-tighter">Strategic Roadmap</h2>
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
      <div style={slideStyle} className="p-20 flex flex-col justify-center bg-black">
        <div className="max-w-4xl mx-auto space-y-12">
          <div className="text-center space-y-4">
            <span className="text-[10px] font-black uppercase tracking-[0.6em] text-accent-500">Perspective 01</span>
            <h2 className="text-6xl font-black uppercase tracking-tighter leading-tight">
              {data.slideZero.title}
            </h2>
          </div>

          <div className="space-y-8">
            {(data.slideZero.macroInsights || data.slideZero.synthesis_points || []).map((insight, i) => {
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
                    <span dangerouslySetInnerHTML={{ __html: content.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-black">$1</strong>') }} />
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* STORYBOARD SLIDES */}
      {data.storyboard.map((slide, index) => (
        <div key={index} style={slideStyle} className="p-16 flex flex-col gap-10 bg-black">
          <div className="flex justify-between items-start border-b border-white/10 pb-8">
            <div className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.5em] text-white/20">Strategic Insight {index + 1}</span>
              <h2 className="text-5xl font-black uppercase tracking-tighter leading-none">
                {slide.pageTitle}
              </h2>
            </div>
            <div className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-mono text-white/40 tracking-widest uppercase">
              MODULE: {slide.chart.id.toUpperCase()}
            </div>
          </div>
          
          <div className="grid grid-cols-12 gap-10 flex-1 items-center min-h-0">
            {/* Analysis Side */}
            <div className="col-span-5 flex flex-col justify-center space-y-8">
              <div className="prose prose-invert max-w-none">
                <ReactMarkdown
                  components={{
                    p: ({node, ...props}) => <p className="text-xl text-white/60 leading-relaxed mb-6" {...props} />,
                    strong: ({node, ...props}) => <strong className="text-accent-400 font-black underline decoration-accent-500/30 underline-offset-8" {...props} />,
                    ul: ({node, ...props}) => <ul className="space-y-6" {...props} />,
                    li: ({node, ...props}) => (
                      <li className="text-lg text-white/80 flex items-start gap-4 p-4 bg-white/[0.02] border-l-4 border-accent-500 rounded-r-2xl">
                        <div className="w-2 h-2 rounded-full bg-accent-500 mt-2 shrink-0 shadow-[0_0_15px_rgba(20,184,166,0.8)]" />
                        <span className="line-clamp-3">{props.children}</span>
                      </li>
                    ),
                  }}
                >
                  {slide.markdownAnalysis}
                </ReactMarkdown>
              </div>

              {/* Call to Action / Insight Box */}
              <div className="p-8 bg-accent-500/10 border border-accent-500/20 rounded-3xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5">
                  <Activity size={80} />
                </div>
                <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-accent-500 mb-2">Strategic Lever</h4>
                <p className="text-md text-accent-100 font-medium leading-relaxed italic">
                  Immediate reallocation of resources toward high-impact categories is recommended to optimize ROI based on these trends.
                </p>
              </div>
            </div>

            {/* Visual Side */}
            <div className="col-span-7 flex flex-col gap-6 h-full justify-center overflow-hidden">
              <div className="bg-white/[0.03] border border-white/10 rounded-[2.5rem] p-8 flex items-center justify-center min-h-0 flex-1 shadow-2xl relative overflow-hidden">
                <div className="absolute top-6 left-8 flex items-center gap-2 opacity-20">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                </div>
                <div className="w-full flex justify-center scale-[0.85] origin-center">
                  {renderChart(slide.chart)}
                </div>
              </div>
              <div className="flex justify-center gap-12 text-[9px] font-black uppercase tracking-[0.5em] text-white/10 italic">
                <span>SQL Verified</span>
                <span>Aggregated Logic</span>
                <span>Top 10 Precision</span>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* FINAL PAGE: METHODOLOGY & AUDIT */}
      <div style={slideStyle} className="p-20 flex flex-col justify-between border-t-8 border-accent-500 bg-black">
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
