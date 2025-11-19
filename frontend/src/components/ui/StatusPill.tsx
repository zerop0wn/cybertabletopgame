import React from 'react';

type Props = {
  intent?: 'neutral' | 'success' | 'warning' | 'danger';
  label: string;
  value: string;
};

export default function StatusPill({ intent = 'neutral', label, value }: Props) {
  const intentColors = {
    neutral: 'bg-slate-700 text-slate-300',
    success: 'bg-green-700 text-green-300',
    warning: 'bg-yellow-700 text-yellow-300',
    danger: 'bg-red-700 text-red-300',
  };

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${intentColors[intent]}`}>
      <span className="opacity-75">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

