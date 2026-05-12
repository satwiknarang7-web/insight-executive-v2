import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, ChevronUp, ChevronDown, TerminalSquare, Cpu, Database, Binary, GripHorizontal } from 'lucide-react';

export default function AgentTerminal({ logs = [], isProcessing = false }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const scrollRef = useRef(null);

  // Auto-scroll when logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const variants = {
    expanded: { 
      width: 420, 
      height: 380, 
      opacity: 1, 
      borderRadius: "16px",
      transition: { type: "spring", damping: 20, stiffness: 100 }
    },
    minimized: { 
      width: 220, 
      height: 48, 
      opacity: 0.9, 
      borderRadius: "9999px",
      transition: { type: "spring", damping: 25, stiffness: 120 }
    }
  };

  const getAgentColor = (agent) => {
    switch (agent?.toLowerCase()) {
      case 'engineer': return 'text-cyan-400';
      case 'analyst': return 'text-pink-400';
      case 'bridge': return 'text-emerald-400';
      case 'system': return 'text-white/40';
      default: return 'text-gray-400';
    }
  };

  const getAgentIcon = (agent) => {
    switch (agent?.toLowerCase()) {
      case 'engineer': return <Database size={12} />;
      case 'analyst': return <Cpu size={12} />;
      case 'bridge': return <Binary size={12} />;
      default: return <Terminal size={12} />;
    }
  };

  return (
    <motion.div 
      drag
      dragConstraints={{ left: -1000, right: 0, top: -800, bottom: 0 }}
      variants={variants}
      animate={isExpanded ? "expanded" : "minimized"}
      className="fixed bottom-4 right-4 z-50 bg-[#0a0a0a] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl flex flex-col overflow-hidden"
    >
      {/* Header / Drag Handle */}
      <div 
        className={`px-4 flex items-center justify-between cursor-grab active:cursor-grabbing group h-12 shrink-0 ${isExpanded ? 'bg-white/[0.03] border-b border-white/5' : ''}`}
        onClick={() => !isExpanded && setIsExpanded(true)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-amber-500 animate-pulse' : logs.length > 0 ? 'bg-emerald-400' : 'bg-white/20'}`} />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/60 group-hover:text-white transition-colors">
            {isExpanded ? "AI Orchestration Engine" : isProcessing ? "Processing..." : logs.length > 0 ? "Complete" : "System Idle"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isExpanded && <GripHorizontal size={14} className="text-white/10 group-hover:text-white/30" />}
          <button 
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            className="p-1.5 hover:bg-white/5 rounded-full text-white/20 hover:text-white transition-all"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col min-h-0"
          >
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed scrollbar-hide"
            >
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-white/10 gap-3">
                  <TerminalSquare size={32} strokeWidth={1} />
                  <span className="uppercase tracking-widest text-[9px] font-black">Awaiting execution...</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {logs.map((log, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex flex-col gap-1 border-l border-white/5 pl-3 py-1"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`flex items-center gap-1 font-black uppercase text-[9px] tracking-tighter ${getAgentColor(log.agent)}`}>
                          {getAgentIcon(log.agent)}
                          {log.agent}
                        </span>
                        <span className="text-[8px] text-white/10">{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}</span>
                      </div>
                      <div className={`whitespace-pre-wrap break-words ${log.agent === 'system' ? 'text-white/30 italic' : 'text-white/80'}`}>
                        {log.message}
                      </div>
                      {log.sql && (
                        <div className="mt-2 p-2 bg-black/50 border border-cyan-500/20 text-cyan-400 rounded-md overflow-x-auto">
                          <span className="text-[8px] font-black text-cyan-500/40 block mb-1 uppercase tracking-widest">Generated SQL Query</span>
                          {log.sql}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Terminal Footer */}
            <div className="px-4 py-2 bg-black flex items-center justify-between border-t border-white/5 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/40" />
                <span className="text-[8px] text-white/20 uppercase font-bold tracking-widest">Status: Monitoring</span>
              </div>
              <div className="text-[8px] text-white/10 font-mono text-cyan-500/40 animate-pulse">
                TRX_COLLAB_SYNC
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
