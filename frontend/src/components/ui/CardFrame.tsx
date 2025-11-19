import React from 'react';

type Props = {
  children: React.ReactNode;
  className?: string;
};

export default function CardFrame({ children, className = '' }: Props) {
  return (
    <div className={`bg-slate-800 rounded-lg border border-slate-700 ${className}`}>
      {children}
    </div>
  );
}

