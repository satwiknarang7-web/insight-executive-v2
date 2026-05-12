import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MousePointer2 } from 'lucide-react';

export default function LiveCursors({ users = [] }) {
  return (
    <div className="fixed inset-0 z-[1000] pointer-events-none overflow-hidden">
      <AnimatePresence>
        {users.map((user) => (
          user.cursor && (
            <motion.div
              key={user.clientId}
              initial={{ opacity: 0 }}
              animate={{ 
                opacity: 1,
                x: user.cursor.x,
                y: user.cursor.y 
              }}
              exit={{ opacity: 0 }}
              transition={{ 
                type: "spring", 
                damping: 30, 
                stiffness: 250, 
                mass: 0.5 
              }}
              className="absolute flex flex-col items-start gap-1"
            >
              <MousePointer2 
                size={20} 
                fill={user.color} 
                stroke="white" 
                strokeWidth={1.5}
                className="drop-shadow-lg"
              />
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="px-2 py-0.5 rounded-full backdrop-blur-md border border-white/20 text-[8px] font-black uppercase tracking-widest text-white whitespace-nowrap shadow-xl"
                style={{ backgroundColor: `${user.color}66` }}
              >
                {user.name}
              </motion.div>
            </motion.div>
          )
        ))}
      </AnimatePresence>
    </div>
  );
}
