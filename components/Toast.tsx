'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, AlertCircle, Info, X } from 'lucide-react';

// ── Types ──

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void;
}

// ── Context ──

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

// ── Provider ──

const MAX_TOASTS = 5;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info', duration = 5000) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts(prev => {
      const next = [...prev, { id, message, type, duration }];
      return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next;
    });
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

// ── Container ──

function ToastContainer({
  toasts,
  onRemove,
}: {
  toasts: ToastItem[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-6 right-6 z-[9200] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map(t => (
          <ToastElement key={t.id} toast={t} onRemove={onRemove} />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ── Individual Toast ──

const icons = {
  success: Check,
  error: AlertCircle,
  info: Info,
};

const colors = {
  success: 'text-emerald-400',
  error: 'text-rose-400',
  info: 'text-gray-400',
};

const borders = {
  success: 'border-emerald-500/20',
  error: 'border-rose-500/20',
  info: 'border-white/[0.08]',
};

function ToastElement({
  toast,
  onRemove,
}: {
  toast: ToastItem;
  onRemove: (id: string) => void;
}) {
  const Icon = icons[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.95 }}
      transition={{ type: 'spring', damping: 22, stiffness: 300 }}
      className={`pointer-events-auto flex items-start gap-3 min-w-[280px] max-w-[400px] px-4 py-3 rounded-xl border ${borders[toast.type]} bg-neutral-900/90 backdrop-blur-xl cursor-pointer`}
      onClick={() => onRemove(toast.id)}
    >
      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${colors[toast.type]}`} />
      <p className="text-sm text-white flex-1 leading-snug">{toast.message}</p>
      <button className="text-gray-600 hover:text-gray-400 flex-shrink-0 mt-0.5">
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  );
}
