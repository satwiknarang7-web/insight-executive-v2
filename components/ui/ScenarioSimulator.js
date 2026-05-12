import React from 'react';
import { motion } from 'framer-motion';
import { Settings2, TrendingUp, TrendingDown, RefreshCcw, Activity, Target, Zap } from 'lucide-react';

export default function ScenarioSimulator({ levers = [], scenarios = {}, onChange, onReset }) {
  if (!levers || levers.length === 0) return null;

  const getIcon = (impact) => {
    return impact === 'positive' ? <TrendingUp size={14} /> : <TrendingDown size={14} />;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-4xl mt-12 p-8 bg-white/[0.02] border border-white/5 rounded-3xl backdrop-blur-xl relative overflow-hidden group shadow-2xl"
    >
      <div className="absolute top-0 right-0 p-4">
        <button 
          onClick={onReset}
          className="p-2 hover:bg-white/5 rounded-full text-white/20 hover:text-cyan-400 transition-all active:rotate-180 duration-500"
          title="Reset Simulation"
        >
          <RefreshCcw size={16} />
        </button>
      </div>

      <div className="flex items-center gap-4 mb-8">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 border border-amber-500/20">
          <Target size={20} />
        </div>
        <div>
          <h3 className="text-lg font-black tracking-tight text-white">Vertical-Specific Simulation</h3>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">AI-Selected Strategic Levers</p>
        </div>
      </div>

      <div className={`grid grid-cols-1 md:grid-cols-${Math.min(levers.length, 3)} gap-10`}>
        {levers.map((lever) => (
          <div key={lever.dataKey} className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/40">
                {getIcon(lever.impact)}
                {lever.name}
              </div>
              <span className={`text-xs font-bold font-mono ${scenarios[lever.dataKey] > 0 ? 'text-emerald-400' : scenarios[lever.dataKey] < 0 ? 'text-red-400' : 'text-white/40'}`}>
                {scenarios[lever.dataKey] > 0 ? '+' : ''}{scenarios[lever.dataKey]}%
              </span>
            </div>
            
            <input 
              type="range"
              min={-20}
              max={20}
              value={scenarios[lever.dataKey] || 0}
              onChange={(e) => onChange(lever.dataKey, parseInt(e.target.value))}
              className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 transition-all"
            />
            
            <div className="flex justify-between text-[8px] font-bold text-white/10 uppercase tracking-tighter">
              <span>-20%</span>
              <span className="text-[7px] opacity-40">Neutral Baseline</span>
              <span>+20%</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-white/20">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          Reactive Domain Projection Active
        </div>
        <div className="text-[10px] font-mono text-white/40 italic flex items-center gap-2">
          <Zap size={10} className="text-cyan-500" />
          Modeling impact on primary performance indicators
        </div>
      </div>
    </motion.div>
  );
}
