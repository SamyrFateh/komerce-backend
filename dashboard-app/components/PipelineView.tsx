import React from 'react';
import { mockPipelineData } from '../data/mockData';
import { formatKMF, getStatusLabel, getStatusColor } from '../utils/formatters';
import type { PipelineData, Order } from '../types';
import { api } from '../utils/api';
import { useApi } from '../utils/useApi';
import { LoadingError } from './LoadingError';

const STATUSES = [
  'confirmed', 'ordered', 'preparation', 'shipped', 'in_transit',
  'available', 'collected', 'cancelled', 'refunded',
] as const;

type StatusKey = typeof STATUSES[number];

const ACTIVE_STATUSES = new Set<string>([
  'confirmed', 'ordered', 'preparation', 'shipped', 'in_transit', 'available',
]);

function getAgeColor(age: number): string {
  if (age < 28) return 'text-success';
  if (age < 35) return 'text-warning';
  return 'text-error';
}

function getPaymentBadge(status: string): string {
  if (status === 'paid') return 'badge-success';
  if (status === 'pending') return 'badge-warning';
  if (status === 'refunded') return 'badge-info';
  return 'badge-ghost';
}

function getPaymentLabel(status: string): string {
  const labels: Record<string, string> = {
    paid: 'Payé',
    pending: 'En attente',
    refunded: 'Remboursé',
  };
  return labels[status] || status;
}

interface OrderCardProps {
  order: Order;
}

const OrderCard: React.FC<OrderCardProps> = ({ order }) => (
  <div className="card bg-base-300 mb-2">
    <div className="card-body p-3">
      <div className="font-bold text-sm">{order.reference}</div>
      <div className="text-xs text-base-content/60">{order.client_name}</div>
      <div className="text-xs text-base-content/60 truncate">{order.product_name}</div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-sm font-semibold">{formatKMF(order.total_kmf)}</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className={`text-xs font-bold ${getAgeColor(order.age_jours)}`}>
          {order.age_jours}j
        </span>
        <span className={`badge ${getPaymentBadge(order.payment_status)} badge-xs`}>
          {getPaymentLabel(order.payment_status)}
        </span>
      </div>
    </div>
  </div>
);

export const PipelineView: React.FC = () => {
  const { data, loading, error, reload, usingMock } = useApi(() => api.pipeline(), mockPipelineData, 15000);

  return (
    <div className="flex flex-col gap-3 p-4">
      <LoadingError loading={loading} error={error} usingMock={usingMock} reload={reload} />
      {!loading && data && (
        <>
          {/* Top summary */}
          <div className="flex items-center gap-4">
            <div className="text-base-content/60 text-sm">
              Total : <span className="font-bold text-base-content">{data.total}</span> commandes
            </div>
            <div className="text-base-content/60 text-sm">
              Actives : <span className="font-bold text-base-content">{data.active}</span>
            </div>
          </div>

          {/* Kanban board */}
          <div className="flex flex-row overflow-x-auto gap-3 pb-4">
            {STATUSES.map(status => {
              const col = data.pipeline[status];
              const isActive = ACTIVE_STATUSES.has(status);
              return (
                <div key={status} className="min-w-[220px] flex-shrink-0 flex flex-col">
                  {/* Column header */}
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-sm font-bold">{getStatusLabel(status)}</span>
                    <span className={`badge ${isActive ? 'badge-primary' : 'badge-neutral'} badge-sm`}>
                      {col.count}
                    </span>
                  </div>
                  {/* Orders list */}
                  <div className="flex-1 max-h-[60vh] overflow-y-auto pr-1">
                    {col.orders.length === 0 ? (
                      <div className="text-xs text-base-content/40 text-center py-4">
                        {col.count > 0
                          ? `${col.count} commande(s)`
                          : 'Aucune commande'}
                      </div>
                    ) : (
                      col.orders.map(order => (
                        <OrderCard key={order.id} order={order} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
