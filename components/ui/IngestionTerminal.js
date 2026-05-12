import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Shield, CheckCircle2, AlertTriangle, Zap } from 'lucide-react';

export default function IngestionTerminal({ logs, stage, progress, isComplete }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-2xl bg-slate-950 border border-white/10 rounded-xl overflow-hidden shadow-2xl flex flex-col h-[500px]"
      >
        {/* Header */}
        <div className="px-4 py-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/50" />
              <div className="w-3 h-3 rounded-full bg-amber-500/50" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/50" />
            </div>
            <div className="h-4 w-px bg-white/10 mx-1" />
            <div className="flex items-center gap-2 text-[10px] font-mono text-white/40 uppercase tracking-[0.2em]">
              <Terminal size={12} />
              Secure Data Ingestion Pipeline v2.0
            </div>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20">
            <Shield size={10} className="text-emerald-400" />
            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest">Encrypted</span>
          </div>
        </div>

        {/* Content */}
        <div 
          ref={scrollRef}
          className="flex-1 p-6 font-mono text-xs overflow-y-auto scrollbar-hide space-y-1"
        >
          {logs.map((log, index) => (
            <motion.div 
              key={index}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className={`
                ${log.startsWith('>') ? 'text-cyan-400' : 'text-white/60'}
                ${log.includes('Redacted') ? 'text-amber-400' : ''}
                ${log.includes('complete') ? 'text-emerald-400 font-bold' : ''}
              `}
            >
              {log}
            </motion.div>
          ))}
          {!isComplete && (
            <div className="flex items-center gap-2 text-cyan-400/50 animate-pulse">
              <span className="w-1.5 h-4 bg-cyan-400" />
              Processing...
            </div>
          )}
          {isComplete && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="text-emerald-400" size={24} />
              </div>
              <div>
                <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest">
                  Data Secured & Verified
                </div>
                <div className="text-[10px] text-emerald-400/60 mt-0.5">
                  Initiating Executive Dashboard Synthesis...
                </div>
              </div>
              <div className="ml-auto">
                <Zap className="text-emerald-400 animate-bounce" size={20} />
              </div>
            </motion.div>
          )}
        </div>

        {/* Footer / Progress */}
        <div className="px-6 py-4 bg-white/5 border-t border-white/10">
          <div className="flex justify-between items-end mb-2">
            <div className="space-y-1">
              <div className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Current Stage</div>
              <div className="text-[11px] text-white/80 font-mono uppercase tracking-widest">{stage || 'Initializing...'}</div>
            </div>
            <div className="text-[11px] text-cyan-400 font-mono font-bold">{progress}%</div>
          </div>
          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]"
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
