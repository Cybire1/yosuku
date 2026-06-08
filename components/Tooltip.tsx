'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';

interface TooltipProps {
  text: string;
  position?: 'top' | 'bottom';
  children?: React.ReactNode;
}

export default function Tooltip({ text, position = 'top', children }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="tooltip-wrap"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children || <Info className="tooltip-icon" />}
      {visible && (
        <span className={`tooltip-bubble ${position}`}>
          {text}
          <span className="tooltip-arrow" />
        </span>
      )}
    </span>
  );
}
