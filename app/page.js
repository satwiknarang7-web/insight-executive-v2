"use client";

import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from "react";
import { 
  Search, Loader2, Database, BarChart3, BarChart2, Code2, Terminal, 
  Upload, FileText, X, CheckCircle2, TrendingUp, Hash, 
  Rows, ChevronDown, ChevronUp, Table as TableIcon, LayoutDashboard,
  Zap, Sparkles, ShieldCheck, Shield, Globe, Activity, ChevronLeft, ChevronRight,
  Download, Play, Pause, Users, DollarSign, Target, TrendingDown, AlertTriangle, Wand2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Papa from "papaparse";
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area, LabelList
} from "recharts";
import ReactMarkdown from "react-markdown";
import DynamicChart from "../components/charts/DynamicChart";
import IngestionTerminal from "../components/ui/IngestionTerminal";
import SimulationDrawer from "../components/ui/SimulationDrawer";
import AgentTerminal from "../components/ui/AgentTerminal";
import LiveCursors from "../components/ui/LiveCursors";
import { sanitizeDataset, cleanFloatingPoints } from "./utils/dataCleaner";
import { downloadCleanedCSV } from "./utils/export";
import { generateDatasetSummary } from "./utils/dataCompressor";
import { useMultiplayer } from "../hooks/useMultiplayer";


import { CHART_COLORS } from "../lib/constants";

// Mock Datasets
const MOCK_DATASETS = {
  churn: `customer_id,region,contract_type,monthly_charge,tenure_months,churn_risk\nC001,North,Month-to-month,85.50,2,High\nC002,South,One year,50.00,12,Low\nC003,East,Month-to-month,95.00,5,High\nC004,West,Two year,65.00,24,Low\nC005,North,Month-to-month,105.00,1,High`,
  revenue: `product_line,q1_revenue,q2_revenue,leakage_amount,leakage_source\nFiber Optic,1200000,1150000,50000,Billing Error\nDSL,400000,380000,20000,Uncollected\nMobile,2500000,2400000,100000,Discount Abuse\nCloud,800000,850000,5000,SLA Penalty`,
  performance: `campaign_name,spend,impressions,conversions,cpa\nQ1_Promo,50000,1000000,5000,10\nHoliday_Special,120000,3000000,10000,12\nBackToSchool,30000,500000,2000,15\nFlash_Sale,15000,200000,1500,10`
};

// Error Boundary for chart rendering safety
class ChartErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error('[ChartErrorBoundary]', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-white/20 gap-4">
          <Activity size={48} strokeWidth={1} />
          <p className="text-xs font-bold uppercase tracking-[0.3em]">Visualization Error</p>
          <p className="text-[10px] text-white/10">The chart data could not be rendered.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// Safe inline bold renderer (replaces dangerouslySetInnerHTML)
const SafeBoldText = ({ text, className = '' }) => {
  if (!text) return null;
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-black text-cyan-400 tracking-wider">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

// Memoized Chart Component (extracted from render to avoid stale closure)
const StrategicChart = React.memo(({ chart, simulationLevers, simulationLeversConfig }) => {
  const result = chart.resultData;
  const type = chart.chart_type?.toLowerCase() || 'bar';
  
  if (!result || result.length === 0) return (
    <div className="h-full flex flex-col items-center justify-center text-white/20 gap-4">
      <Activity size={48} strokeWidth={1} />
      <p className="text-xs font-bold uppercase tracking-[0.3em]">No Data Points</p>
    </div>
  );

  const { x, y, highlightKey } = React.useMemo(() => {
    const keys = Object.keys(result[0]);
    const xKey = chart.xAxisKey || keys.find(k => typeof result[0][k] === 'string') || keys[0];
    const nKeys = keys.filter(k => typeof result[0][k] === 'number' && k !== xKey);
    let yKey = chart.yAxisKey || (nKeys.length > 1 ? nKeys : nKeys[0]) || keys.find(k => k !== xKey) || keys[keys.length - 1];
    
    const supportsMultiSeries = ['composed', 'radar', 'dual', 'multi'].some(t => type.includes(t));
    if (Array.isArray(yKey) && !supportsMultiSeries) {
      yKey = yKey[0];
    }
    
    return { x: xKey, y: yKey, highlightKey: Array.isArray(yKey) ? yKey[0] : yKey };
  }, [chart, result, type]);

  const { maxVal, delta, maxItemName } = React.useMemo(() => {
    let maxV = -Infinity;
    let sumV = 0;
    for (let i = 0; i < result.length; i++) {
      const val = Number(result[i][highlightKey]) || 0;
      if (val > maxV) maxV = val;
      sumV += val;
    }
    if (maxV === -Infinity) maxV = 0;
    const avgV = result.length > 0 ? sumV / result.length : 0;
    const d = avgV > 0 ? ((maxV - avgV) / avgV * 100).toFixed(1) : 0;
    const mItem = result.find(d => Number(d[highlightKey]) === maxV);
    
    let mName = mItem ? mItem[x] : '';
    if (typeof mName === 'number' || !isNaN(Number(mName))) {
      const keys = Object.keys(result[0]);
      const stringKey = keys.find(k => typeof result[0][k] === 'string' && k !== x && k !== highlightKey);
      if (stringKey) mName = mItem[stringKey];
    }
    if (!mName || typeof mName === 'number') mName = "Peak Performance Point";
    
    return { maxVal: maxV, delta: d, maxItemName: mName };
  }, [result, highlightKey, x]);

  const dataWithProjections = React.useMemo(() => {
    const simulationActive = simulationLeversConfig.some(l => (simulationLevers[l.dataKey] || 0) !== 0);
    if (!simulationActive) return result;

    return result.map(item => {
      const newItem = { ...item };
      simulationLeversConfig.forEach(lever => {
        const sliderValue = simulationLevers[lever.dataKey] || 0;
        const targetKPI = lever.target_kpi || highlightKey;
        const multiplier = lever.impact_multiplier || (lever.impact === 'negative' ? -1 : 1);
        const originalKPIVal = Number(item[targetKPI]);
        if (!isNaN(originalKPIVal)) {
          const rippleDelta = (sliderValue / 100) * multiplier;
          newItem[`Projected ${targetKPI}`] = originalKPIVal * (1 + rippleDelta);
        }
      });
      const primaryProjectedKey = `Projected ${highlightKey}`;
      if (newItem[primaryProjectedKey] === undefined) {
        newItem[primaryProjectedKey] = Number(item[highlightKey]);
      }
      return newItem;
    });
  }, [result, simulationLevers, simulationLeversConfig, highlightKey]);

  const simulationActive = simulationLeversConfig.some(l => (simulationLevers[l.dataKey] || 0) !== 0);
  const [manualChartType, setManualChartType] = useState('auto');
  
  const chartTypes = ['auto', 'bar', 'line', 'area', 'donut', 'radial', 'scatter', 'treemap', 'radar', 'composed'];
  
  const cycleChartType = () => {
    const currentIndex = chartTypes.indexOf(manualChartType);
    const nextIndex = (currentIndex + 1) % chartTypes.length;
    setManualChartType(chartTypes[nextIndex]);
  };

  return (
    <div className="w-full h-full flex flex-col px-2 pb-2">
      <div className="flex items-center gap-3 mb-2 z-10 relative shrink-0 flex-wrap">
        <div className="px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[11px] font-semibold text-cyan-400 flex items-center gap-2 max-w-[280px] truncate">
          <Sparkles size={12} />
          <span className="truncate">Target: {maxItemName}</span>
          <span className="text-cyan-500/40 hidden lg:inline">| High Impact</span>
        </div>
        <div className={`px-3 py-1.5 rounded-full border text-xs font-bold flex items-center gap-1 ${delta > 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
          {delta > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {Math.abs(delta)}% vs Avg
        </div>

        <button 
          onClick={cycleChartType}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-500/40 transition-all text-[10px] font-black uppercase tracking-widest text-white/60 hover:text-cyan-400"
        >
          <BarChart2 size={12} className={manualChartType !== 'auto' ? 'text-cyan-400' : ''} />
          {manualChartType === 'auto' ? 'Auto Select' : manualChartType}
        </button>
        {simulationActive && (
          <div className="px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-black text-amber-500 flex items-center gap-2 uppercase tracking-widest">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Simulation Active
          </div>
        )}
      </div>
      <div className="flex-1 w-full mt-4 bg-white/[0.01] rounded-2xl border border-white/5 p-2 relative" style={{ minHeight: '500px' }}>
        <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-100 transition-opacity pointer-events-none">
          <Activity size={16} className="text-cyan-500" />
        </div>
        <div className="w-full h-full absolute inset-0 p-2 pt-6">
          <ChartErrorBoundary>
            <DynamicChart 
              data={dataWithProjections} 
              type={manualChartType === 'auto' ? chart.chart_type : manualChartType}
              xKey={x} 
              yKey={y} 
              secondaryYKey={chart.secondaryYAxisKey}
            />
          </ChartErrorBoundary>
        </div>
      </div>
    </div>
  );
});

// Dynamic Text Resizing Wrapper
const DynamicTextFit = ({ children, min = 10, max = 18 }) => {
  const containerRef = useRef(null);
  const [fontSize, setFontSize] = useState(max);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let currentSize = max;
    container.style.fontSize = `${currentSize}px`;

    // Simple iterative reduction to fit container height
    while (container.scrollHeight > container.clientHeight && currentSize > min) {
      currentSize -= 0.5;
      container.style.fontSize = `${currentSize}px`;
    }
    setFontSize(currentSize);
  }, [children, min, max]);

  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden leading-snug" style={{ fontSize: `${fontSize}px` }}>
      {children}
    </div>
  );
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [apiError, setApiError] = useState(null);
  const [isSimulationOpen, setIsSimulationOpen] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [particles] = useState(() => Array.from({ length: 20 }).map(() => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 2 + 1,
    duration: Math.random() * 20 + 10,
    delay: Math.random() * 5,
    color: CHART_COLORS[Math.floor(Math.random() * CHART_COLORS.length)]
  })));


  const [mounted, setMounted] = useState(false);
  
  // App State Machine
  const [appState, setAppState] = useState("setup"); // 'setup' | 'analyzing' | 'storyboard'
  const [isQuerying, setIsQuerying] = useState(false);
  
  // Ingestion Pipeline State
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestionLogs, setIngestionLogs] = useState([]);
  const [ingestionStage, setIngestionStage] = useState("");
  const [ingestionProgress, setIngestionProgress] = useState(0);
  const [isIngestionComplete, setIsIngestionComplete] = useState(false);
  const [ingestionMetrics, setIngestionMetrics] = useState({ totalRows: 0, anomalies: 0, redactedPII: 0, outliersCount: 0 });
  const [agentLogs, setAgentLogs] = useState([]);
  // Helper to auto-timestamp agent logs
  const addAgentLog = (log) => setAgentLogs(prev => [...prev, { ...log, timestamp: Date.now() }]);
  const setAgentLogsTimestamped = (logs) => setAgentLogs(logs.map(l => ({ ...l, timestamp: l.timestamp || Date.now() })));
  
  // Multiplayer State
  const { 
    syncedState: multiplayerLevers, 
    updateSimulationState, 
    resetSimulationState, 
    remoteUsers, 
    updateCursorPosition 
  } = useMultiplayer();
  
  // Scenario Simulation State
  const [simulationLevers, setSimulationLevers] = useState({});
  const [simulationLeversConfig, setSimulationLeversConfig] = useState([]);

  // Sync Multiplayer -> Local Simulation Levers
  useEffect(() => {
    if (multiplayerLevers && Object.keys(multiplayerLevers).length > 0) {
      setSimulationLevers(prev => ({ ...prev, ...multiplayerLevers }));
    }
  }, [multiplayerLevers]);

  const handleLeverChange = (id, val) => {
    setSimulationLevers(prev => ({ ...prev, [id]: val }));
    updateSimulationState(id, val);
  };

  const resetSimulation = () => {
    const reset = {};
    simulationLeversConfig.forEach(l => {
      reset[l.dataKey] = 0;
    });
    setSimulationLevers(reset);
    resetSimulationState();
  };

  const handleMouseMove = (e) => {
    // Only update multiplayer cursor frequently, throttle local state if needed
    updateCursorPosition(e.clientX, e.clientY);
    
    // Throttle local mouse position updates for the background effect
    if (!window._mouseThrottle) {
      window._mouseThrottle = true;
      setTimeout(() => {
        setMousePosition({ x: e.clientX, y: e.clientY });
        window._mouseThrottle = false;
      }, 50); // 20fps for background effects is plenty
    }
  };
  const [currentPage, setCurrentPage] = useState(0);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [isAutoplay, setIsAutoplay] = useState(false);
  const [autoplayKey, setAutoplayKey] = useState(0);
  const [playSpeed, setPlaySpeed] = useState(8000);
  
  // Data Assets State
  const [csvContent, setCsvContent] = useState(null);
  const [fileName, setFileName] = useState("");
  const [customSchema, setCustomSchema] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [cleanedDataset, setCleanedDataset] = useState([]);
  const [rawDataset, setRawDataset] = useState([]);
  
  const fileInputRef = useRef(null);

  const loadTemplate = (templateKey) => {
    // RESET GLOBAL STATE BEFORE LOADING NEW TEMPLATE
    setAppState("setup");
    setData(null);
    setAgentLogs([]);
    setCurrentPage(0);
    setIngestionMetrics({ totalRows: 0, anomalies: 0, redactedPII: 0, outliersCount: 0 });
    setSimulationLevers({});
    setSimulationLeversConfig([]);
    setApiError(null);
    setError("");

    const csvString = MOCK_DATASETS[templateKey];
    const file = new File([csvString], `${templateKey}_demo.csv`, { type: "text/csv" });
    handleFileUpload(file);
  };

  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Lazy Load Insights on Navigation
  useEffect(() => {
    if (appState !== "storyboard" || currentPage === 0 || !data || !data.storyboard) return;
    
    const slide = data.storyboard[currentPage - 1];
    if (slide && !slide.insight_anchor && !slide.isSynthesizing) {
      handleLazySynthesis(currentPage - 1);
    }
  }, [currentPage, appState, data]);

  const handleLazySynthesis = async (index) => {
    const slide = data.storyboard[index];
    if (!slide || isQuerying) return;

    setIsQuerying(true);
    
    // Optimistically mark as synthesizing to prevent loops
    setData(prev => {
      if (!prev || !prev.storyboard) return prev;
      const newStoryboard = [...prev.storyboard];
      newStoryboard[index] = { ...newStoryboard[index], isSynthesizing: true };
      return { ...prev, storyboard: newStoryboard };
    });

    setAgentLogs(prev => [
      ...prev,
      { agent: 'analyst', message: `Synthesizing deep-dive insights for slide: ${slide.pageTitle || slide.chart?.title}...` }
    ]);

    try {
      const compressedContext = generateDatasetSummary(cleanedDataset);
      // Ensure we send the EXACT keys being used in the chart to the Analyst
      const { x, y } = slide.chart; 
      
      const chartSample = {
        ...slide.chart,
        xAxisKey: x,
        yAxisKey: y,
        resultData: slide.chart.resultData?.slice(0, 50) || []
      };

      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userQuestion: "SYNTHESIZE_SLIDE",
          jsonData: cleanedDataset,
          customSchema: customSchema,
          perspective: 'Chart Insight',
          chartData: [chartSample],
          fullDataset: compressedContext
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const newNarrative = result.storyboard?.[0];
        
        setData(prev => {
          if (!prev || !prev.storyboard) return prev;
          const newStoryboard = [...prev.storyboard];
          newStoryboard[index] = {
            ...newStoryboard[index],
            insight_anchor: newNarrative?.insight_anchor || "Synthesis complete (No specific anchor identified).",
            insight_implication: newNarrative?.insight_implication || "Mathematical implication within expected variance.",
            insight_question: newNarrative?.insight_question || "Monitor current trend for drift.",
            markdownAnalysis: newNarrative?.markdownAnalysis || "Engine completed analysis but returned no narrative segments.",
            isSynthesizing: false
          };
          return { ...prev, storyboard: newStoryboard };
        });
      } else {
        throw new Error(`API returned ${response.status}`);
      }
    } catch (err) {
      console.error("Lazy Synthesis Failed:", err);
      // Ensure we clear the flag so it doesn't loop, but maybe allow one retry? 
      // For now, mark as failed to stop the crash.
      setData(prev => {
        if (!prev || !prev.storyboard) return prev;
        const newStoryboard = [...prev.storyboard];
        newStoryboard[index] = { 
          ...newStoryboard[index], 
          insight_anchor: "Error during synthesis.",
          isSynthesizing: false 
        };
        return { ...prev, storyboard: newStoryboard };
      });
    } finally {
      setIsQuerying(false);
    }
  };

  // Autoplay Engine
  useEffect(() => {
    if (!isAutoplay || appState !== "storyboard") return;
    const totalSlidesCount = (data?.storyboard?.length || 0) + 1;
    const timer = setTimeout(() => {
      setCurrentPage(p => {
        const next = p + 1;
        if (next >= totalSlidesCount) {
          setIsAutoplay(false);
          return p;
        }
        setAutoplayKey(k => k + 1);
        return next;
      });
    }, playSpeed);
    return () => clearTimeout(timer);
  }, [isAutoplay, currentPage, appState, data, playSpeed]);

  // StrategicChart is now defined outside as a React.memo component (see above)

  if (!mounted) return null;

  // --- DOWNLOAD HANDLER ---
  const downloadCleanedData = () => {
    if (!cleanedDataset || cleanedDataset.length === 0) return;

    // 1. Extract headers
    const headers = Object.keys(cleanedDataset[0]);
    
    // 2. Build CSV rows
    const csvRows = cleanedDataset.map(row => {
      return headers.map(header => {
        let val = row[header];
        if (val === null || val === undefined) val = "";
        const stringVal = String(val);
        const escaped = stringVal.replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(",");
    });

    // 3. Combine header and rows
    const csvString = [headers.join(","), ...csvRows].join("\n");

    // 4. Create Blob and Trigger Download
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    // STRICTLY enforce the .csv extension
    link.download = 'insight_executive_cleaned_data.csv'; 
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadFullPDFReport = async () => {
    if (!data) return;
    try {
      const response = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) throw new Error('PDF Generation Failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Insight_Executive_Report.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error("PDF Export Error:", error);
    }
  };

  // --- API HANDLERS ---
  const handleAnalyze = async () => {
    setAppState("analyzing");
    setError("");
    setApiError(null);
    setData(null);
    setAgentLogs([
      { agent: 'system', message: 'Initializing industrial-grade analysis pipeline...' },
      { agent: 'engineer', message: 'Constructing high-cardinality data projections...' }
    ]);
    
    try {
      const compressedContext = generateDatasetSummary(cleanedDataset);
      
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userQuestion: "GLOBAL_INIT",
          jsonData: cleanedDataset,
          customSchema: customSchema,
          perspective: 'Executive Synthesis',
          chartData: null,
          fullDataset: compressedContext
        }),
      });

      
      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`API failed with status ${response.status}: ${errorData}`);
      }
      
      const json = await response.json();
      
      // Initialize dynamic simulation levers if provided
      if (json.slideZero?.simulation_levers) {
        setSimulationLeversConfig(json.slideZero.simulation_levers);
        const initialLevers = {};
        json.slideZero.simulation_levers.forEach(l => {
          initialLevers[l.dataKey] = 0;
        });
        setSimulationLevers(initialLevers);
      }
      
      // Detailed transparency logs
      setAgentLogs(prev => [
        ...prev, 
        { agent: 'bridge', message: 'AlaSQL transformation successful. Mathematical rigor verified.' },
        { agent: 'analyst', message: 'Synthesizing strategic markdown narrative based on validated metrics.' }
      ]);

      if (json.storyboard?.[0]?.sql) {
        setAgentLogs(prev => [...prev, { agent: 'engineer', message: 'Optimized SQL generated.', sql: json.storyboard[0].sql }]);
      }

      setData(json);
      setAppState("storyboard");
      setCurrentPage(0);
    } catch (err) {
      console.error("Analysis Pipeline Failed:", err);
      setAgentLogs(prev => [...prev, { agent: 'system', message: `PIPELINE_ERROR: ${err.message}` }]);
      setApiError(err.message);
      setAppState("setup");
    }
  };

  const handleGenerate = async () => {
    if (!query.trim()) return;
    setIsQuerying(true);
    setError("");
    setApiError(null);
    setAgentLogs(prev => [
      ...prev,
      { agent: 'system', message: `Incoming query: "${query}"` },
      { agent: 'engineer', message: 'Analyzing intent and constructing schema-aware SQL...' }
    ]);

    try {
      const compressedContext = generateDatasetSummary(cleanedDataset);

      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userQuestion: query,
          jsonData: cleanedDataset,
          customSchema: customSchema,
          perspective: 'Executive Synthesis',
          chartData: null,
          fullDataset: compressedContext
        }),
      });


      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`API failed with status ${response.status}: ${errorData}`);
      }

      const json = await response.json();

      // Update dynamic simulation levers if new perspective provides them
      if (json.slideZero?.simulation_levers) {
        setSimulationLeversConfig(json.slideZero.simulation_levers);
        const initialLevers = {};
        json.slideZero.simulation_levers.forEach(l => {
          initialLevers[l.dataKey] = 0;
        });
        setSimulationLevers(initialLevers);
      }

      setAgentLogs(prev => [
        ...prev, 
        { agent: 'bridge', message: 'SQL results validated against population distribution.' },
        { agent: 'analyst', message: 'Generating executive synthesis for the new perspective.' }
      ]);

      if (json.storyboard?.[0]?.sql) {
        setAgentLogs(prev => [...prev, { agent: 'engineer', message: 'Pass 1 complete. SQL validated.', sql: json.storyboard[0].sql }]);
      }

      setData(json);
      setAppState("storyboard");
      setCurrentPage(0);
    } catch (err) {
      console.error("Analysis Pipeline Failed:", err);
      setAgentLogs(prev => [...prev, { agent: 'system', message: `ORCHESTRATION_ERROR: ${err.message}` }]);
      setApiError(err.message);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleHardReset = () => {
    setAppState("setup");
    setData(null);
    setQuery("");
    setError("");
    setApiError(null);
    setIngestionLogs([]);
    setAgentLogs([]);
    setCurrentPage(0);
    setFileName("");
    setCsvContent(null);
    setCustomSchema("");
    setCleanedDataset([]);
    setRawDataset([]);
    setSimulationLevers({});
    setSimulationLeversConfig([]);
    setIngestionMetrics({ totalRows: 0, anomalies: 0, redactedPII: 0, outliersCount: 0 });
    setIsIngestionComplete(false);
    setIsIngesting(false);
    setShowAuditTrail(false);
  };

  const handleFileUpload = (file) => {
    if (!file || file.type !== "text/csv") {
      setError("Please upload a valid CSV file.");
      return;
    }
    
    setFileName(file.name);
    setIngestionLogs([]);
    setIngestionStage("Initializing...");
    setIngestionProgress(0);
    setIsIngesting(true);
    setIsIngestionComplete(false);
    
    // FLUSH OLD STATE ON NEW INGESTION
    setAgentLogs([]);
    setData(null);
    setCurrentPage(0);
    setSimulationLevers({});
    setSimulationLeversConfig([]);
    setIngestionMetrics({ totalRows: 0, anomalies: 0, redactedPII: 0, outliersCount: 0 });

    const worker = new Worker(new URL('./workers/dataSanitizer.worker.js', import.meta.url));
    
    worker.onmessage = (e) => {
      const { type, message, stage, progress, data, metrics, error } = e.data;
      
      switch (type) {
        case 'log':
          setIngestionLogs(prev => [...prev, message]);
          break;
        case 'status':
          setIngestionStage(stage);
          setIngestionProgress(progress);
          break;
        case 'complete':
          setIsIngestionComplete(true);
          setIngestionMetrics(metrics);
          const headers = Object.keys(data[0] || {});
          // Build a rich, typed schema with sample values so the AI knows exactly what each column contains
          const schemaLines = headers.map(h => {
            const sampleVals = data.slice(0, 3).map(row => row[h]).filter(v => v !== null && v !== undefined);
            const isNumeric = sampleVals.length > 0 && sampleVals.every(v => !isNaN(Number(v)));
            const type = isNumeric ? 'DECIMAL' : 'VARCHAR';
            return `- ${h} (${type}) — e.g. ${sampleVals.slice(0, 3).join(', ')}`;
          });
          const schema = `Table: SalesData\nColumns:\n${schemaLines.join("\n")}`;
          setCustomSchema(schema);
          setCsvContent(Papa.unparse(data));
          setCleanedDataset(data);
          setError("");
          
          setTimeout(() => {
            setIsIngesting(false);
            worker.terminate();
          }, 2000);
          break;
        case 'error':
          setError(error);
          setIsIngesting(false);
          worker.terminate();
          break;
      }
    };

    worker.postMessage({ file });
  };

  // --- CHART RENDERER ---
  const formatValue = (val) => {
    if (typeof val !== 'number') return val;
    if (Math.abs(val) >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return Number(val.toFixed(2));
  };

  const formatTooltipValue = (value, name) => {
    if (typeof value !== 'number') return [value, name];
    const isCurrency = String(name).toLowerCase().match(/(charge|price|revenue|cost|amount)/);
    const formattedNum = Math.abs(value) >= 1000000 ? (value / 1000000).toFixed(1) + 'M' : 
                         Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) + 'K' : 
                         Number(value.toFixed(2));
    return isCurrency ? [`$${formattedNum}`, name] : [formattedNum, name];
  };



  // Chart slides are offset by 1 because currentPage=0 is Slide Zero
  const chartIndex = currentPage - 1;
  const currentSlide = chartIndex >= 0 ? data?.storyboard?.[chartIndex] : null;
  // Defensive Text Parsing: kill inline asterisks by forcing them to a new line (ignores **bold**)
  const analysisRaw = currentSlide?.markdownAnalysis;
  const analysisStr = Array.isArray(analysisRaw) ? analysisRaw.join('\n') : (typeof analysisRaw === 'string' ? analysisRaw : String(analysisRaw || ''));
  const rawCleanMarkdown = analysisStr.replace(/```(?:markdown)?/gi, '').replace(/```/g, '').trim();
  const cleanedAnalysis = cleanFloatingPoints(rawCleanMarkdown);
  const cleanMarkdown = cleanedAnalysis.replace(/(^|\s)\*(?!\*)/g, '$1\n* ');
  const totalSlides = (data?.storyboard?.length || 0) + 1; // +1 for Slide Zero

  return (
    <main 
      onMouseMove={handleMouseMove}
      className="min-h-screen w-full bg-[#030303] text-white font-['Outfit'] overflow-x-hidden flex flex-col md:flex-row p-0 m-0 relative selection:bg-cyan-500/30"
    >
      {/* Dynamic Background Elements */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        {!isMobile && (
          <motion.div 
            animate={{ 
              x: mousePosition.x - 400, 
              y: mousePosition.y - 400 
            }}
            transition={{ type: "spring", damping: 30, stiffness: 50, mass: 0.5 }}
            className="absolute w-[800px] h-[800px] bg-slate-500/5 rounded-full blur-[120px] mix-blend-screen opacity-50"
          />
        )}
        
        {particles.map((p, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: `${p.x}%`, y: "110%" }}
            animate={{ 
              y: ["110%", "-10%"],
              opacity: [0, 0.2, 0]
            }}
            transition={{ 
              duration: p.duration, 
              repeat: Infinity, 
              delay: p.delay,
              ease: "linear" 
            }}
            className="absolute w-[1px] h-[30px] blur-[1px]"
            style={{ left: `${p.x}%`, backgroundColor: p.color }}
          />
        ))}

        {/* Global Scanline Effect */}
        <div className="absolute inset-0 z-[100] pointer-events-none opacity-[0.03] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_4px,3px_100%]" />
        
        {/* Premium Noise Grain */}
        <div className="absolute inset-0 z-[101] pointer-events-none opacity-[0.15] bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')] contrast-150 brightness-100" />
      </div>

      {/* COMMAND CONSOLE (Left Sidebar) */}
      {appState === "storyboard" && (
        <aside className="w-full md:w-64 flex-shrink-0 md:h-full bg-[#050505] border-b md:border-b-0 md:border-r border-white/5 flex flex-col justify-between p-6 z-20 relative">
          
          {/* Top: Branding + Search + Health */}
          <div className="flex flex-col gap-6">
            <motion.div 
              initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-4 cursor-pointer"
              onClick={handleHardReset}
            >
              <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center text-black shadow-[0_0_20px_rgba(6,182,212,0.4)]">
                <Zap size={20} fill="currentColor" />
              </div>
              <div className="flex flex-col">
                <span className="font-black text-lg tracking-tighter leading-none">Insight</span>
                <span className="text-[8px] font-black uppercase tracking-[0.4em] text-cyan-500">Executive v2</span>
              </div>
            </motion.div>

            {rawDataset.length - cleanedDataset.length > 0 && (
              <div 
                onClick={downloadCleanedData}
                className="group flex items-center justify-between gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold tracking-widest uppercase [clip-path:polygon(0_0,_calc(100%-10px)_0,_100%_10px,_100%_100%,_10px_100%,_0_calc(100%-10px))] hover:bg-emerald-500/20 transition-all cursor-pointer relative overflow-hidden"
              >
                <div className="flex items-center gap-2">
                  <Shield className="w-3 h-3" /> 
                  <span className="group-hover:hidden">{ingestionMetrics.anomalies + ingestionMetrics.outliersCount} Anomalies Secured</span>
                  <span className="hidden group-hover:inline-block">Export Audit Trail</span>
                </div>
                <Download size={12} className="opacity-40 group-hover:opacity-100 transition-opacity" />
              </div>
            )}

            {appState === "storyboard" && data && (
              <div className="flex flex-col gap-2">
                <button 
                  onClick={downloadFullPDFReport}
                  className="flex items-center justify-between gap-3 px-3 py-2 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-all text-[10px] font-black uppercase tracking-[0.3em] [clip-path:polygon(0_0,_calc(100%-8px)_0,_100%_8px,_100%_100%,_8px_100%,_0_calc(100%-8px))]"
                >
                  <div className="flex items-center gap-2">
                    <FileText size={14} />
                    <span>Download Full PDF Report</span>
                  </div>
                  <Download size={12} />
                </button>

                {cleanedDataset.length > 0 && (
                  <button 
                    onClick={() => downloadCleanedCSV(cleanedDataset)}
                    className="flex items-center justify-between gap-3 px-3 py-2 bg-transparent border border-cyan-500/30 text-cyan-400/80 hover:bg-cyan-500/10 transition-all text-[10px] font-black uppercase tracking-[0.3em] [clip-path:polygon(0_0,_calc(100%-8px)_0,_100%_8px,_100%_100%,_8px_100%,_0_calc(100%-8px))]"
                  >
                    <div className="flex items-center gap-2">
                      <Database size={14} />
                      <span>Export Sanitized CSV</span>
                    </div>
                    <Download size={12} className="opacity-50" />
                  </button>
                )}
              </div>
            )}

            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-cyan-500 transition-colors" size={14} />
              <input 
                type="text"
                className="w-full pl-10 pr-3 py-2 bg-white/5 border border-white/10 outline-none text-xs font-medium placeholder:text-white/20 focus:border-cyan-500/50 transition-all [clip-path:polygon(0_0,_calc(100%-8px)_0,_100%_8px,_100%_100%,_8px_100%,_0_calc(100%-8px))]"
                placeholder="Probe dataset..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              />
            </div>

            {/* Dataset Health Score */}
            {cleanedDataset.length > 0 && (
              <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">Integrity Score</span>
                  <span className={`text-[10px] font-black ${ingestionMetrics.totalCells > 0 && (ingestionMetrics.totalCells - ingestionMetrics.totalAnomalies) / ingestionMetrics.totalCells > 0.9 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {ingestionMetrics.totalCells > 0 
                      ? ((ingestionMetrics.totalCells - ingestionMetrics.totalAnomalies) / ingestionMetrics.totalCells * 100).toFixed(1) 
                      : '0'}%
                  </span>
                </div>
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-1000 ${ingestionMetrics.totalCells > 0 && (ingestionMetrics.totalCells - ingestionMetrics.totalAnomalies) / ingestionMetrics.totalCells > 0.9 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    style={{ width: `${ingestionMetrics.totalCells > 0 ? ((ingestionMetrics.totalCells - ingestionMetrics.totalAnomalies) / ingestionMetrics.totalCells * 100) : 0}%` }}
                  />
                </div>
                <div className="flex items-center gap-4 mt-1">
                  <div className="flex flex-col">
                    <span className="text-[14px] font-bold text-white/80">{ingestionMetrics.totalRows || 0}</span>
                    <span className="text-[8px] uppercase font-bold text-white/20">Scanned</span>
                  </div>
                  <div className="w-px h-6 bg-white/10" />
                  <div className="flex flex-col">
                    <span className="text-[14px] font-bold text-red-400">{ingestionMetrics.outliersCount || 0}</span>
                    <span className="text-[8px] uppercase font-bold text-white/20">Outliers</span>
                  </div>
                </div>
              </div>
            )}

            <button 
              onClick={() => setShowAuditTrail(true)}
              className="flex items-center gap-3 px-3 py-2 bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all text-[10px] font-black uppercase tracking-[0.3em] [clip-path:polygon(0_0,_calc(100%-8px)_0,_100%_8px,_100%_100%,_8px_100%,_0_calc(100%-8px))]"
            >
              <Code2 size={14} /> Audit Trail
            </button>
          </div>

          {/* Middle: Perspective + Slide Indicators */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black uppercase tracking-[0.4em] text-white/20">{isAutoplay ? "Presenting" : "Perspective"}</span>
              <span className="text-sm font-bold text-white/60">{currentPage === 0 ? "Executive Synthesis" : "Global Strategy Dashboard"}</span>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1 flex-wrap">
                {Array.from({ length: totalSlides }).map((_, i) => (
                  <div 
                    key={i} 
                    className={`h-1 rounded-full transition-all duration-500 cursor-pointer ${i === currentPage ? "w-8 bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.5)]" : i === 0 ? "w-5 bg-yellow-500/30" : "w-4 bg-white/10"}`}
                    onClick={() => { setIsAutoplay(false); setCurrentPage(i); }}
                  />
                ))}
              </div>
              <span className="text-[9px] font-black uppercase tracking-[0.4em] text-white/20">{currentPage === 0 ? "Synthesis" : `Slide ${currentPage} of ${totalSlides - 1}`}</span>
            </div>
          </div>

          {/* Bottom: Playback Controls */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => { setIsAutoplay(false); setCurrentPage(p => Math.max(0, p - 1)); }}
                disabled={currentPage === 0}
                className={`p-3 border border-white/10 transition-all flex-1 flex items-center justify-center [clip-path:polygon(0_0,_calc(100%-6px)_0,_100%_6px,_100%_100%,_6px_100%,_0_calc(100%-6px))] ${currentPage === 0 ? "opacity-20 cursor-not-allowed" : "bg-white/5 hover:bg-white/10 active:scale-95"}`}
              >
                <ChevronLeft size={18} />
              </button>
              <button 
                onClick={() => { setIsAutoplay(a => !a); setAutoplayKey(k => k + 1); }}
                className={`p-3 border transition-all flex-1 flex items-center justify-center [clip-path:polygon(0_0,_calc(100%-6px)_0,_100%_6px,_100%_100%,_6px_100%,_0_calc(100%-6px))] ${
                  isAutoplay 
                    ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.2)]" 
                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                {isAutoplay ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button 
                onClick={() => { setPlaySpeed(prev => prev === 8000 ? 5000 : prev === 5000 ? 4000 : prev === 4000 ? 16000 : 8000); setAutoplayKey(k => k + 1); }}
                className="p-3 bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/10 transition-all active:scale-95 flex-1 text-center [clip-path:polygon(0_0,_calc(100%-6px)_0,_100%_6px,_100%_100%,_6px_100%,_0_calc(100%-6px))]"
              >
                {playSpeed === 16000 ? "0.5x" : playSpeed === 8000 ? "1x" : playSpeed === 5000 ? "1.5x" : "2x"}
              </button>
              <button 
                onClick={() => { setIsAutoplay(false); setCurrentPage(p => Math.min(totalSlides - 1, p + 1)); }}
                disabled={currentPage === totalSlides - 1}
                className={`p-3 border border-white/10 transition-all flex-1 flex items-center justify-center [clip-path:polygon(0_0,_calc(100%-6px)_0,_100%_6px,_100%_100%,_6px_100%,_0_calc(100%-6px))] ${currentPage === totalSlides - 1 ? "opacity-20 cursor-not-allowed" : "bg-white/5 hover:bg-white/10 active:scale-95"}`}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* PROJECTION CANVAS (Main Right Column) */}
      <div className={`flex-1 min-h-screen relative flex flex-col z-10 transition-all duration-500 ease-in-out ${isSimulationOpen && !isMobile ? 'mr-[350px]' : ''}`}>
        
        {/* GLOBAL HEADER (Multiplayer & Simulation) */}
        {appState === "storyboard" && (
          <header className="absolute top-8 right-8 z-[60] flex items-center gap-4">
            <button 
              onClick={() => setIsSimulationOpen(!isSimulationOpen)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all duration-300 ${
                isSimulationOpen 
                  ? 'bg-cyan-500 border-cyan-400 text-black shadow-[0_0_20px_rgba(6,182,212,0.4)]' 
                  : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Wand2 size={16} className={isSimulationOpen ? 'animate-pulse' : ''} />
              <span className="text-[11px] font-black uppercase tracking-widest">Simulation Mode</span>
            </button>
            
            <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-900/50 border border-slate-700 rounded-full text-[10px] font-black text-white/40 uppercase tracking-widest">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Sync
            </div>
          </header>
        )}

        {/* The Drawer itself */}
        <SimulationDrawer 
          isOpen={isSimulationOpen}
          onClose={() => setIsSimulationOpen(false)}
          levers={simulationLeversConfig}
          scenarios={simulationLevers} 
          onChange={handleLeverChange} 
          onReset={resetSimulation} 
        />
        
        {/* HUD Progress Bar (top edge) */}
        <AnimatePresence>
          {isAutoplay && appState === "storyboard" && (
            <motion.div
              key={`progress-${currentPage}-${autoplayKey}`}
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: playSpeed / 1000, ease: "linear" }}
              className="h-1 bg-gradient-to-r from-cyan-500 to-cyan-400 absolute top-0 left-0 z-50 shadow-[0_0_15px_rgba(6,182,212,0.5)]"
            />
          )}
        </AnimatePresence>

        {/* Setup Branding (only visible in setup mode) */}
        {appState === "setup" && (
          <motion.div 
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
            className="absolute top-8 left-8 flex items-center gap-4 cursor-pointer z-20"
            onClick={() => setAppState("setup")}
          >
            <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center text-black shadow-[0_0_20px_rgba(6,182,212,0.4)]">
              <Zap size={20} fill="currentColor" />
            </div>
            <div className="flex flex-col">
              <span className="font-black text-lg tracking-tighter leading-none">Insight</span>
              <span className="text-[8px] font-black uppercase tracking-[0.4em] text-cyan-500">Executive v2</span>
            </div>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          
          {/* SETUP VIEW */}
          {appState === "setup" && (
            <motion.div 
              key="setup"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }}
              className="w-full max-w-[1400px] h-full flex flex-col md:flex-row items-center justify-center gap-12 lg:gap-24 mx-auto px-6 md:px-12 py-12 perspective-[1200px]"
            >
              {/* Left Column: Branding & Text with 3D Tilt */}
              <motion.div 
                animate={{ 
                  rotateY: (mousePosition.x - (typeof window !== 'undefined' ? window.innerWidth : 1400) / 2) / 80,
                  rotateX: -(mousePosition.y - (typeof window !== 'undefined' ? window.innerHeight : 900) / 2) / 80,
                }}
                transition={{ type: "spring", damping: 30, stiffness: 50 }}
                className="flex flex-col items-start text-left max-w-xl relative z-10 w-full md:w-1/2"
              >
                <div className="absolute top-1/2 left-0 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none -z-10" />
                
                {/* Ultimate Reactor Core Icon */}
                <div className="flex items-center gap-8 mb-10 group/core">
                  <div className="relative w-24 h-24 flex items-center justify-center">
                    {/* Pulsing Aura */}
                    <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-2xl animate-pulse group-hover/core:bg-cyan-500/40 transition-all duration-700" />
                    
                    {/* Rotating Rings */}
                    <motion.div 
                      animate={{ rotate: 360 }} 
                      transition={{ duration: 15, repeat: Infinity, ease: "linear" }} 
                      className="absolute inset-[-12px] rounded-full border-[1.5px] border-cyan-500/20 border-t-cyan-500/60" 
                    />
                    <motion.div 
                      animate={{ rotate: -360 }} 
                      transition={{ duration: 10, repeat: Infinity, ease: "linear" }} 
                      className="absolute inset-[-4px] rounded-full border border-blue-500/10 border-b-blue-500/40" 
                    />
                    
                    {/* The Core */}
                    <div className="w-16 h-16 rounded-2xl bg-black border border-white/10 flex items-center justify-center relative z-10 overflow-hidden group-hover/core:border-cyan-500/50 transition-colors">
                      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 to-blue-500/20" />
                      <Database size={32} className="text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
                      
                      {/* Internal Shimmer */}
                      <motion.div 
                        animate={{ x: ["-100%", "100%"] }} 
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-white/10 to-transparent -skew-x-12" 
                      />
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                      <div className="h-px w-8 bg-cyan-500/30" />
                      <div className="px-3 py-0.5 rounded-full bg-cyan-500 text-[9px] font-black uppercase tracking-[0.2em] text-black shadow-[0_0_15px_rgba(6,182,212,0.5)]">
                        Active
                      </div>
                    </div>
                    <div className="text-[11px] font-black text-white tracking-[0.4em] uppercase opacity-40 italic">Neural Gateway v4.0</div>
                  </div>
                </div>

                <div className="relative group/title w-full">
                  <h1 className="text-5xl md:text-[92px] font-black tracking-[-0.05em] text-white leading-[0.9] mb-6 md:mb-8 relative z-10">
                    Instant <br />
                    Data <br />
                    <span className="relative inline-block">
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-cyan-400 bg-[size:200%_auto] animate-[shimmer_4s_linear_infinite]">Storyboards</span>
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: "100%" }}
                        transition={{ duration: 1, delay: 0.5 }}
                        className="absolute -bottom-2 left-0 h-[3px] bg-gradient-to-r from-cyan-500 to-transparent" 
                      />
                    </span>
                  </h1>
                  <style jsx>{`
                    @keyframes shimmer {
                      0% { background-position: 0% 50%; }
                      100% { background-position: 200% 50%; }
                    }
                  `}</style>
                </div>

                <p className="text-base md:text-xl text-white/50 font-medium tracking-tight leading-relaxed max-w-lg relative pl-6 md:pl-8 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-gradient-to-b before:from-cyan-500 before:to-transparent">
                  Turn your spreadsheets into professional executive reports. Upload any CSV to get <span className="font-semibold text-white/80">clear charts</span> and expert insights in seconds.
                </p>

                {apiError && (
                  <div className="bg-red-900/20 border border-red-500/50 p-4 rounded-xl w-full backdrop-blur-md mt-6">
                    <h3 className="text-red-400 font-bold text-sm tracking-widest uppercase mb-1">System Failure</h3>
                    <p className="text-red-200 font-mono text-xs break-words">{apiError}</p>
                  </div>
                )}
              </motion.div>

                {/* Interaction Panel with 3D Parallax */}
                <motion.div 
                  animate={{ 
                    rotateY: (mousePosition.x - (typeof window !== 'undefined' ? window.innerWidth : 1400) / 2) / 100,
                    rotateX: -(mousePosition.y - (typeof window !== 'undefined' ? window.innerHeight : 900) / 2) / 100,
                  }}
                  transition={{ type: "spring", damping: 30, stiffness: 50 }}
                  className="w-full md:w-1/2 max-w-xl flex flex-col gap-8 relative z-10"
                >
                  
                  {/* Neural Dropzone */}
                  <div className="w-full p-1 bg-gradient-to-br from-white/20 via-cyan-500/10 to-transparent rounded-[3rem] shadow-2xl relative group/drop overflow-hidden">
                    <div className="absolute inset-0 bg-cyan-500/5 blur-3xl group-hover/drop:bg-cyan-500/20 transition-all duration-1000 -z-10" />
                    
                    {/* Cyber Deck HUD Readouts */}
                    <div className="absolute top-6 left-10 text-[8px] font-mono text-cyan-500/40 uppercase tracking-[0.3em] flex gap-6 z-20">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-cyan-500/40 rounded-full animate-pulse" />
                        UPLINK: ACTIVE
                      </div>
                      <div className="hidden lg:block">GATEWAY: {mounted ? (Date.now() % 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0') : '------'}</div>
                      <div className="hidden lg:block">SEC_LAYER: V4.4</div>
                    </div>
                    
                    {/* Animated Edge Glow */}
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-[edge_3s_linear_infinite]" />
                    
                    <div 
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileUpload(e.dataTransfer.files[0]); }}
                      className={`p-6 md:p-10 rounded-[2rem] md:rounded-[2.8rem] border border-white/10 flex flex-col items-center justify-center text-center gap-6 md:gap-8 transition-all backdrop-blur-[40px] backdrop-saturate-[2.5] min-h-[300px] md:min-h-[360px] relative ${isDragging ? "border-cyan-400 bg-cyan-500/20 scale-[1.01]" : fileName ? "border-cyan-500/50 bg-cyan-500/5" : "bg-black/60 hover:bg-black/80 shadow-[inset_0_0_40px_rgba(255,255,255,0.02)]"}`}
                    >
                      <div className={`w-24 h-24 shrink-0 rounded-[2rem] flex items-center justify-center transition-all relative ${fileName ? "bg-cyan-500 text-black shadow-[0_0_50px_rgba(6,182,212,0.6)] scale-110" : "bg-white/5 text-white/40 group-hover/drop:text-cyan-400 group-hover/drop:bg-cyan-500/10 group-hover/drop:shadow-[0_0_30px_rgba(6,182,212,0.3)]"}`}>
                        <div className="absolute inset-0 rounded-[2rem] border border-white/10 animate-ping opacity-20" />
                        {fileName ? <CheckCircle2 size={48} /> : <Upload size={48} />}
                      </div>
                      <div className="space-y-3 md:space-y-4">
                        <p className="text-2xl md:text-4xl font-black tracking-tighter text-white uppercase italic">{fileName || "Initiate Link"}</p>
                        <p className="text-[10px] text-white/40 font-black uppercase tracking-[0.4em]">{fileName ? "Encryption Sequence Verified" : "System awaiting data ingestion"}</p>
                      </div>
                      <input type="file" ref={fileInputRef} onChange={(e) => handleFileUpload(e.target.files[0])} className="hidden" accept=".csv" />
                      <button 
                        onClick={() => fileName ? handleAnalyze() : fileInputRef.current.click()}
                        className="group/btn px-10 py-5 bg-white text-black font-black uppercase tracking-[0.2em] text-[10px] rounded-full hover:bg-cyan-400 hover:shadow-[0_0_40px_rgba(6,182,212,0.5)] transition-all active:scale-95 w-full max-w-[280px] relative overflow-hidden"
                      >
                        <span className="relative z-10">{fileName ? "Launch Neural Synthesis" : "Establish Uplink"}</span>
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/5 to-transparent -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000" />
                      </button>
                    </div>
                  </div>


                  <style jsx>{`
                    @keyframes edge {
                      0% { transform: translateX(-100%); }
                      100% { transform: translateX(100%); }
                    }
                  `}</style>

                {/* Compact Template Gallery */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-4 px-2 mb-1">
                    <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Or Load Demo Asset</p>
                    <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                  </div>
                  <div className="flex flex-col gap-3">
                    <button onClick={() => loadTemplate('churn')} className="flex items-center justify-between p-4 rounded-2xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.04] hover:border-cyan-500/40 transition-all group relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/0 via-cyan-500/0 to-cyan-500/0 group-hover:via-cyan-500/[0.05] transition-all duration-500" />
                      <div className="flex items-center gap-4 relative z-10">
                        <div className="p-3 rounded-xl bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500 group-hover:text-black transition-all shadow-inner"><Users size={20} /></div>
                        <div className="text-left">
                          <p className="text-sm font-black text-white group-hover:text-cyan-400 transition-colors tracking-tight">Customer Churn Analysis</p>
                          <p className="text-[10px] text-white/30 uppercase font-black tracking-widest mt-1">Predictive Modeling</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 relative z-10">
                        <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden group-hover:bg-white/10 transition-colors">
                          <motion.div animate={{ x: [-48, 48] }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} className="w-full h-full bg-cyan-500" />
                        </div>
                        <ChevronRight size={16} className="text-white/20 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
                      </div>
                    </button>

                    <button onClick={() => loadTemplate('revenue')} className="flex items-center justify-between p-4 rounded-2xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.04] hover:border-emerald-500/40 transition-all group relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/0 to-emerald-500/0 group-hover:via-emerald-500/[0.05] transition-all duration-500" />
                      <div className="flex items-center gap-4 relative z-10">
                        <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-black transition-all shadow-inner"><DollarSign size={20} /></div>
                        <div className="text-left">
                          <p className="text-sm font-black text-white group-hover:text-emerald-400 transition-colors tracking-tight">Revenue Leakage Audit</p>
                          <p className="text-[10px] text-white/30 uppercase font-black tracking-widest mt-1">Financial Forensics</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 relative z-10">
                        <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden group-hover:bg-white/10 transition-colors">
                          <motion.div animate={{ x: [-48, 48] }} transition={{ duration: 2, repeat: Infinity, ease: "linear", delay: 0.5 }} className="w-full h-full bg-emerald-500" />
                        </div>
                        <ChevronRight size={16} className="text-white/20 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
                      </div>
                    </button>
                  </div>
                </div>

                </motion.div>
            </motion.div>
          )}

          {/* ANALYZING VIEW */}
          {appState === "analyzing" && (
            <motion.div 
              key="analyzing"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-8 flex-1 justify-center"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-cyan-500/20 blur-[60px] animate-pulse" />
                <Loader2 size={80} strokeWidth={1} className="animate-spin text-cyan-500 relative" />
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-black tracking-tighter text-white">Synthesizing Narrative</h2>
                <p className="text-white/40 font-medium">Extracting intelligence and generating visualizations...</p>
              </div>
            </motion.div>
          )}

          {/* SLIDE ZERO: EXECUTIVE SYNTHESIS */}
          {appState === "storyboard" && currentPage === 0 && data?.slideZero && (
            <motion.div 
              key="slide-zero"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: -100 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="w-full h-full overflow-hidden flex flex-col items-center relative"
            >

              <div className="flex flex-col items-center justify-start h-full w-full max-w-5xl mx-auto text-center px-6 py-8 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                <motion.div 
                  initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} 
                  transition={{ delay: 0.2, duration: 0.6 }}
                  className="mb-12"
                >
                  <span className="text-[10px] font-black uppercase tracking-[0.5em] text-cyan-500/60 mb-4 block">Macro Intelligence</span>
                  <h2 className="text-5xl md:text-6xl font-extrabold uppercase tracking-tight leading-tight text-center px-4 text-transparent bg-clip-text bg-gradient-to-br from-white via-gray-200 to-gray-600 text-balance">
                    {data.slideZero.title || "Executive Synthesis"}
                  </h2>
                </motion.div>

                {apiError && (
                  <div className="bg-red-900/20 border border-red-500/50 p-6 rounded-md w-full max-w-4xl backdrop-blur-md mb-8">
                    <h3 className="text-red-400 font-bold tracking-widest uppercase mb-2">System Failure</h3>
                    <p className="text-red-200 font-mono text-sm break-words">{apiError}</p>
                  </div>
                )}

                <div className="w-full flex flex-col items-center">
                  {(!data.slideZero.macroInsights || data.slideZero.macroInsights.length === 0) && (!data.slideZero.synthesis_points || data.slideZero.synthesis_points.length === 0) ? (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                      className="bg-white/[0.03] border border-white/10 p-6 mb-4 w-full max-w-4xl backdrop-blur-md [clip-path:polygon(0_0,_calc(100%-20px)_0,_100%_20px,_100%_100%,_20px_100%,_0_calc(100%-20px))]"
                    >
                      <p className="text-gray-300">
                        <span className="text-cyan-500 font-bold tracking-wider mr-2 uppercase text-sm">✦</span>
                        Synthesizing macro intelligence... (If this persists, check terminal for LLM timeouts).
                      </p>
                    </motion.div>
                  ) : (
                    (data.slideZero.synthesis_points || data.slideZero.macroInsights || []).map((insight, index) => {

                      const hasColon = insight.includes(':');
                      const prefix = hasColon ? insight.split(':')[0] : null;
                      const content = hasColon ? insight.split(':').slice(1).join(':').trim() : insight;
                      const sanitizedContent = cleanFloatingPoints(content);

                      return (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.3 + 0.5 }}
                          className="bg-white/[0.03] border border-white/10 p-6 mb-4 w-full max-w-4xl backdrop-blur-md [clip-path:polygon(0_0,_calc(100%-20px)_0,_100%_20px,_100%_100%,_20px_100%,_0_calc(100%-20px))]"
                        >
                          <p className="text-gray-300 text-lg leading-relaxed">
                            {prefix && (
                              <span className="text-cyan-500 font-bold tracking-wider mr-2 uppercase text-sm">
                                {prefix}:
                              </span>
                            )}
                            <SafeBoldText text={sanitizedContent} />
                          </p>
                        </motion.div>
                      );
                    })
                  )}

                  {/* Strategic Scorecard */}
                  {(data.slideZero.strategicScorecard || data.slideZero.primary_focus) && (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 1.5 }}
                      className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl mt-8"
                    >
                      <div className="p-6 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl flex flex-col items-center text-center group hover:bg-cyan-500/20 transition-all">
                        <Zap className="text-cyan-400 mb-3" size={24} />
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-400/60 mb-2">Primary Focus</span>
                        <p className="text-sm font-bold text-white leading-tight">
                          {data.slideZero.primary_focus || (data.slideZero.strategicScorecard && data.slideZero.strategicScorecard.focus)}
                        </p>
                      </div>
                      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-2xl flex flex-col items-center text-center group hover:bg-red-500/20 transition-all">
                        <AlertTriangle className="text-red-400 mb-3" size={24} />
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-red-400/60 mb-2">Critical Risk</span>
                        <p className="text-sm font-bold text-white leading-tight">
                          {data.slideZero.critical_risk || (data.slideZero.strategicScorecard && data.slideZero.strategicScorecard.risk)}
                        </p>
                      </div>
                      <div className="p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex flex-col items-center text-center group hover:bg-emerald-500/20 transition-all">
                        <TrendingUp className="text-emerald-400 mb-3" size={24} />
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400/60 mb-2">Opportunity</span>
                        <p className="text-sm font-bold text-white leading-tight">
                          {data.slideZero.opportunity || (data.slideZero.strategicScorecard && data.slideZero.strategicScorecard.opportunity)}
                        </p>
                      </div>
                    </motion.div>
                  )}



                </div>
              </div>
            </motion.div>
          )}

          {appState === "storyboard" && currentPage > 0 && currentSlide && (
            <motion.div 
              key={currentPage}
              initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -100 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="w-full h-full overflow-hidden flex flex-col md:flex-row relative"
              onViewportEnter={() => console.log("InsightPanel Payload:", currentSlide)}
            >



              {/* Left Column: The Narrative */}
              <div className="w-full md:w-[30%] p-6 md:p-8 flex flex-col relative break-words whitespace-normal bg-[radial-gradient(ellipse_at_left,_var(--tw-gradient-stops))] from-white/[0.03] to-transparent border-b md:border-b-0 md:border-r border-white/5">
                <div className="absolute top-0 left-0 w-32 h-32 bg-cyan-500/10 blur-[80px] -ml-16 -mt-16" />
                
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 bg-white/5 flex items-center justify-center text-cyan-500 [clip-path:polygon(0_0,_calc(100%-8px)_0,_100%_8px,_100%_100%,_20px_100%,_0_calc(100%-20px))]">
                    <FileText size={18} />
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-[0.5em] text-white/20">Executive Insight</span>
                </div>

                <h2 className="text-2xl md:text-3xl font-black uppercase tracking-[0.1em] leading-tight mb-4 text-transparent bg-clip-text bg-gradient-to-br from-white via-white to-white/40 text-balance">
                  {currentSlide.pageTitle}
                </h2>
                
                <div className="flex-grow overflow-hidden mb-4">
                  <DynamicTextFit min={12} max={26}>
                    <div className="space-y-10">
                      <p className="flex items-start gap-4">
                        <span className="mt-2 flex-shrink-0 w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.8)]" />
                        <span>
                          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-cyan-500/80 block mb-2">Key Finding</span>
                          <span className="text-white leading-[1.8] font-medium">
                            {currentSlide.insight_anchor ? (
                              cleanFloatingPoints(currentSlide.insight_anchor)
                            ) : isQuerying ? (
                              <span className="inline-block w-48 h-4 bg-white/5 animate-pulse rounded" />
                            ) : (
                              <span className="text-red-400/60 italic text-[0.8em]">Synthesis engine offline. Check Audit Trail.</span>
                            )}
                          </span>
                        </span>
                      </p>
                      <p className="flex items-start gap-4">
                        <span className="mt-2 flex-shrink-0 w-2 h-2 rounded-full bg-white/20" />
                        <span>
                          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-white/30 block mb-2">Implication</span>
                          <span className="text-slate-200/90 leading-[1.8] font-medium">
                            {currentSlide.insight_implication ? (
                              cleanFloatingPoints(currentSlide.insight_implication)
                            ) : isQuerying ? (
                              <span className="inline-block w-64 h-4 bg-white/5 animate-pulse rounded" />
                            ) : (
                              <span className="text-red-400/60 italic text-[0.8em]">Mathematical implication unavailable.</span>
                            )}
                          </span>
                        </span>
                      </p>
                      <p className="flex items-start gap-4 mt-4 pt-6 border-t border-white/10">
                        <span className="mt-2 flex-shrink-0 w-2 h-2 rounded-sm bg-amber-500/80" />
                        <span>
                          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-amber-500/60 block mb-2">Strategic Question</span>
                          <span className="text-slate-300 italic tracking-tight leading-[1.8] font-medium">
                            {currentSlide.insight_question ? (
                              cleanFloatingPoints(currentSlide.insight_question)
                            ) : isQuerying ? (
                              <span className="inline-block w-56 h-4 bg-white/5 animate-pulse rounded" />
                            ) : (
                              <span className="text-red-400/60 italic text-[0.8em]">Awaiting strategic directive...</span>
                            )}
                          </span>
                        </span>
                      </p>
                    </div>
                  </DynamicTextFit>
                </div>
              </div>

              {/* Right Column: The Visual */}
              <div className="w-full md:w-[70%] p-4 md:p-6 flex flex-col relative bg-white/[0.01]">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.6)]" />
                    <span className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">
                      {isQuerying ? "Synthesizing Strategic Narrative..." : "Live Sync"}
                    </span>

                  </div>
                  <div className="flex items-center gap-4">
                    {/* Maximize and Share icons removed */}
                  </div>
                </div>
                <div className="flex-1 w-full min-h-[350px] md:min-h-[500px]">
                  <StrategicChart 
                    chart={currentSlide.chart} 
                    simulationLevers={simulationLevers}
                    simulationLeversConfig={simulationLeversConfig}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* AUDIT TRAIL MODAL */}
      <AnimatePresence>
        {showAuditTrail && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-12">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowAuditTrail(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
              className="relative w-full max-w-5xl h-[80vh] bg-white/[0.03] border border-white/10 backdrop-blur-md overflow-hidden flex flex-col shadow-2xl [clip-path:polygon(15px_0,100%_0,100%_calc(100%-15px),calc(100%-15px)_100%,0_100%,0_15px)]"
            >
              <div className="p-12 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-500 border border-cyan-500/20">
                    <ShieldCheck size={32} />
                  </div>
                  <div>
                    <h2 className="text-3xl font-black tracking-tight">Audit Trail</h2>
                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-cyan-500/60 mt-1">Mathematical Verification engine</p>
                  </div>
                </div>
                <button onClick={() => setShowAuditTrail(false)} className="p-4 rounded-full hover:bg-white/5 text-white/20 hover:text-white transition-all"><X size={24} /></button>
              </div>

              <div className="p-12 overflow-y-auto flex-grow custom-scrollbar space-y-12">
                {!data || !data.storyboard || data.storyboard.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center border border-dashed border-white/20 bg-white/[0.01] rounded-sm p-20">
                    <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center text-white/20 mb-6 animate-pulse">
                      <Terminal size={40} />
                    </div>
                    <span className="text-xs font-mono font-black tracking-[0.5em] text-white/40 uppercase">Awaiting Query Execution...</span>
                  </div>
                ) : (
                  data.storyboard.map((slide, i) => (
                    <div key={i} className="flex flex-col gap-6">
                      <h3 className="text-xs font-black uppercase tracking-[0.4em] text-white/20">{slide.chart.title}</h3>
                      <div className="p-8 rounded-3xl bg-black border border-white/5 font-mono text-xs leading-relaxed text-cyan-400/80">
                        {slide.chart.sql_query}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Ingestion Terminal Overlay */}
      <AnimatePresence>
        {isIngesting && (
          <IngestionTerminal 
            logs={ingestionLogs}
            stage={ingestionStage}
            progress={ingestionProgress}
            isComplete={isIngestionComplete}
          />
        )}
      </AnimatePresence>
      {/* AGENT ORCHESTRATION TERMINAL */}
      <AgentTerminal logs={agentLogs} isProcessing={isQuerying} />

      {/* MULTIPLAYER PRESENCE */}
      {!isMobile && <LiveCursors users={remoteUsers} />}
    </main>
  );
}
