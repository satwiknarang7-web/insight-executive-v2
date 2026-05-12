import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sliders, RefreshCcw, Target, Zap, X } from 'lucide-react';

export default function SimulationDrawer({ isOpen, onClose, levers = [], scenarios = {}, onChange, onReset }) {
  if (!levers || levers.length === 0) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ x: 350 }}
          animate={{ x: 0 }}
          exit={{ x: 350 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed top-0 right-0 h-full w-[350px] bg-slate-950/98 backdrop-blur-3xl border-l border-cyan-500/30 z-[100] overflow-hidden flex flex-col shadow-[-20px_0_60px_rgba(0,0,0,0.8)]"
        >
          {/* Header */}
          <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-500 border border-cyan-500/20">
                <Target size={16} />
              </div>
              <div>
                <h3 className="text-sm font-black tracking-tight text-white uppercase">Simulation</h3>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20">Active War Room</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={onReset}
                className="p-2 hover:bg-white/5 rounded-full text-white/20 hover:text-cyan-400 transition-all active:rotate-180 duration-500"
                title="Reset Simulation"
              >
                <RefreshCcw size={16} />
              </button>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-full text-white/20 hover:text-white transition-all"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Scrollers */}
          <div className="flex-1 overflow-y-auto p-6 space-y-10 custom-scrollbar">
            {levers.map((lever) => (
              <div key={lever.dataKey} className="flex flex-col gap-4 group">
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/60 group-hover:text-cyan-400 transition-colors">
                      {lever.name}
                    </span>
                    <span className="text-[8px] font-bold text-white/20 uppercase tracking-tight">
                      Target: {lever.target_kpi || 'Primary KPI'}
                    </span>
                  </div>
                  <span className={`text-xs font-black font-mono ${scenarios[lever.dataKey] > 0 ? 'text-emerald-400' : scenarios[lever.dataKey] < 0 ? 'text-red-400' : 'text-white/40'}`}>
                    {scenarios[lever.dataKey] > 0 ? '+' : ''}{scenarios[lever.dataKey]}%
                  </span>
                </div>
                
                <div className="relative flex items-center">
                  <input 
                    type="range"
                    min={-50}
                    max={50}
                    value={scenarios[lever.dataKey] || 0}
                    onChange={(e) => onChange(lever.dataKey, parseInt(e.target.value))}
                    className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 transition-all"
                  />
                  {/* Baseline indicator */}
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-3 bg-white/20 pointer-events-none" />
                </div>
                
                <div className="flex justify-between text-[8px] font-bold text-white/10 uppercase tracking-widest">
                  <span>-50% Reduction</span>
                  <span className="text-cyan-500/20">Strategic Baseline</span>
                  <span>+50% Growth</span>
                </div>
              </div>
            ))}

            {levers.length === 0 && (
              <div className="py-24 flex flex-col items-center justify-center text-center gap-4 opacity-30">
                <Sliders size={48} strokeWidth={1} />
                <p className="text-[11px] font-black uppercase tracking-[0.2em] max-w-[200px] leading-relaxed">
                  No controllable levers detected for this dataset schema.
                </p>
              </div>
            )}
          </div>

          {/* Footer Metrics */}
          <div className="p-6 bg-white/[0.02] border-t border-white/5 mt-auto">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">Projection Delta</span>
                <span className="text-[10px] font-mono text-cyan-400 font-bold">LIVE SYNC</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                  <div className="text-[8px] font-bold text-white/20 uppercase mb-1">Impact Level</div>
                  <div className="text-[10px] font-black text-amber-500 uppercase tracking-widest flex items-center gap-2">
                    <Zap size={10} />
                    {(() => {
                      const avgDelta = levers.length > 0
                        ? levers.reduce((sum, l) => sum + Math.abs(scenarios[l.dataKey] || 0), 0) / levers.length
                        : 0;
                      return avgDelta > 30 ? 'Critical' : avgDelta > 15 ? 'High Force' : avgDelta > 5 ? 'Moderate' : 'Baseline';
                    })()}
                  </div>
                </div>
                <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                  <div className="text-[8px] font-bold text-white/20 uppercase mb-1">Model Confidence</div>
                  <div className={`text-[10px] font-black uppercase tracking-widest ${(() => {
                    const avgDelta = levers.length > 0
                      ? levers.reduce((sum, l) => sum + Math.abs(scenarios[l.dataKey] || 0), 0) / levers.length
                      : 0;
                    return avgDelta > 25 ? 'text-red-400' : avgDelta > 10 ? 'text-amber-400' : 'text-emerald-400';
                  })()}`}>
                    {(() => {
                      const avgDelta = levers.length > 0
                        ? levers.reduce((sum, l) => sum + Math.abs(scenarios[l.dataKey] || 0), 0) / levers.length
                        : 0;
                      return (Math.max(100 - avgDelta * 1.5, 40)).toFixed(1) + '%';
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
