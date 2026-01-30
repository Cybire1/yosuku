'use client';

import { Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';

interface IncognitoToggleProps {
  mode: 'public' | 'private';
  onChange: (mode: 'public' | 'private') => void;
}

export default function IncognitoToggle({ mode, onChange }: IncognitoToggleProps) {
  const isPrivate = mode === 'private';

  return (
    <div className="relative p-1 bg-black/40 rounded-full border border-white/10 flex items-center cursor-pointer" onClick={() => onChange(isPrivate ? 'public' : 'private')}>

      {/* Sliding Background */}
      <motion.div
        initial={false}
        animate={{
          x: isPrivate ? '100%' : '0%',
        }}
        className="absolute left-1 top-1 bottom-1 w-[calc(50%-4px)] bg-neutral-800 rounded-full shadow-lg z-0"
      >
        <div className={`absolute inset-0 rounded-full opacity-20 ${isPrivate ? 'bg-off-blue' : 'bg-off-green'}`} />
        <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-full" />
      </motion.div>

      {/* Option: Public */}
      <div className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-full transition-colors duration-300 ${!isPrivate ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>
        <Eye className="w-4 h-4" />
        <span className="text-xs font-bold uppercase tracking-widest">Public</span>
      </div>

      {/* Option: Private */}
      <div className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-full transition-colors duration-300 ${isPrivate ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>
        <EyeOff className="w-4 h-4" />
        <span className="text-xs font-bold uppercase tracking-widest">Private</span>
        <span className="ml-1 px-1.5 py-0.5 bg-off-blue/20 text-off-blue text-[8px] font-black rounded uppercase tracking-tighter border border-off-blue/20">ZK</span>
      </div>

    </div>
  );
}
