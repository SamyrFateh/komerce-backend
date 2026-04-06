import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number;
  icon?: React.ReactNode;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, sub, trend, icon, className = '' }) => {
  return (
    <div className={`card bg-base-200 shadow-sm ${className}`}>
      <div className="card-body p-4 gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-base-content/60 uppercase tracking-wider">{label}</span>
          {icon && <span className="opacity-60">{icon}</span>}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold">{value}</span>
          {trend !== undefined && (
            <span className={`text-sm font-medium ${trend >= 0 ? 'text-success' : 'text-error'}`}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
        </div>
        {sub && <span className="text-xs text-base-content/50">{sub}</span>}
      </div>
    </div>
  );
};
