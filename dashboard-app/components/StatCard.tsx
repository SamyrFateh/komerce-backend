import React from 'react';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  trend?: number;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ icon, label, value, trend, className }) => {
  const trendBadge = trend !== undefined ? (
    <span className={`badge ${trend >= 0 ? 'badge-success' : 'badge-error'} badge-sm`}>
      {trend > 0 ? '+' : ''}{trend.toFixed(1)}%
    </span>
  ) : null;

  return (
    <div className={`card bg-base-200 ${className || ''}`}>
      <div className="card-body p-4">
        <div className="flex items-center justify-between">
          <div className="opacity-60">{icon}</div>
          {trendBadge}
        </div>
        <div className="text-2xl font-bold mt-2">{value}</div>
        <div className="text-base-content/60 text-sm">{label}</div>
      </div>
    </div>
  );
};
