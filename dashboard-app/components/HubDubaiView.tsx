import React, { useState } from 'react';
import { Package, BoxSelect, Truck, AlertTriangle, CheckCircle, Clock, XCircle, Ban, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { mockHubData } from '../data/mockData';
import { formatKMF } from '../utils/formatters';
import type { HubOrder, OrderProduct, ProductStatus } from '../types';

type HubSection = 'reception' | 'emballage' | 'expedition';

const statusConfig: Record<ProductStatus, { label: string; class: string; icon: React.ReactNode }> = {
  complet: { label: 'Complet', class: 'badge-success', icon: <CheckCircle size={12} /> },
  incomplet: { label: 'Incomplet', class: 'badge-warning', icon: <HelpCircle size={12} /> },
  retard: { label: 'Retard', class: 'badge-error', icon: <Clock size={12} /> },
  defectueux: { label: 'Défectueux', class: 'badge-error', icon: <AlertTriangle size={12} /> },
  annule: { label: 'Annulé', class: 'badge-neutral', icon: <XCircle size={12} /> },
  hors_stock: { label: 'Hors stock', class: 'badge-error', icon: <Ban size={12} /> },
  en_attente: { label: 'En attente', class: 'badge-info', icon: <Clock size={12} /> },
};

function getOrderGlobalStatus(produits: OrderProduct[]) {
  const active = produits.filter(p => p.status !== 'annule');
  if (active.length === 0) return { label: 'Annulé', class: 'text-base-content/50' };
  const allOk = active.every(p => p.status === 'complet');
  if (allOk) return { label: 'Tous complets', class: 'text-success' };
  const hasBlocking = active.some(p => ['hors_stock', 'defectueux', 'retard'].includes(p.status));
  if (hasBlocking) return { label: 'Bloqué', class: 'text-error' };
  return { label: 'Partiel', class: 'text-warning' };
}

function countByStatus(orders: HubOrder[]) {
  const counts: Partial<Record<ProductStatus, number>> = {};
  orders.forEach(o => o.produits.forEach(p => {
    counts[p.status] = (counts[p.status] || 0) + 1;
  }));
  return counts;
}

const OrderCard: React.FC<{
  order: HubOrder;
  actionLabel: string;
  actionIcon: React.ReactNode;
  onAction: (ref: string) => void;
  done: boolean;
}> = ({ order, actionLabel, actionIcon, onAction, done }) => {
  const [expanded, setExpanded] = useState(false);
  const globalStatus = getOrderGlobalStatus(order.produits);
  const nbComplet = order.produits.filter(p => p.status === 'complet').length;
  const nbTotal = order.produits.length;
  const hasIssue = order.produits.some(p => !['complet', 'annule'].includes(p.status));

  return (
    <div className={`card bg-base-200 ${done ? 'opacity-50' : ''} ${order.priorite === 'urgente' ? 'border-l-4 border-error' : ''}`}>
      <div className="card-body p-4 gap-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-primary">{order.reference}</span>
            {order.priorite === 'urgente' && <span className="badge badge-error badge-sm">URGENT</span>}
            <span className={`text-sm font-semibold ${globalStatus.class}`}>{globalStatus.label}</span>
          </div>
          <span className="text-sm opacity-60">J+{order.jours}</span>
        </div>

        {/* Client & meta */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="font-medium">{order.client_nom}</span>
          {order.fournisseur && <span className="opacity-60">📦 {order.fournisseur}</span>}
          {order.poids_kg && <span className="opacity-60">⚖️ {order.poids_kg} kg</span>}
          <span className="opacity-60">{formatKMF(order.total_kmf)}</span>
        </div>

        {/* Products summary bar */}
        <div
          className="flex items-center justify-between cursor-pointer hover:bg-base-300 rounded-lg p-2 -mx-2"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">{nbComplet}/{nbTotal} produits complets</span>
            {hasIssue && <AlertTriangle size={14} className="text-warning" />}
          </div>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>

        {/* Expanded product list */}
        {expanded && (
          <div className="overflow-x-auto">
            <table className="table table-xs w-full">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Qté</th>
                  <th>Prix</th>
                  <th>Statut</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {order.produits.map((p, i) => {
                  const sc = statusConfig[p.status];
                  return (
                    <tr key={i} className={p.status === 'annule' ? 'opacity-40 line-through' : ''}>
                      <td className="font-medium">{p.nom}</td>
                      <td>{p.quantite}</td>
                      <td>{formatKMF(p.prix_kmf)}</td>
                      <td>
                        <span className={`badge badge-sm gap-1 ${sc.class}`}>
                          {sc.icon} {sc.label}
                        </span>
                      </td>
                      <td className="text-xs opacity-70 max-w-[200px] truncate">{p.note || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Action button */}
        <div className="flex justify-end mt-1">
          <button
            className={`btn btn-sm ${done ? 'btn-disabled' : 'btn-primary'}`}
            onClick={() => !done && onAction(order.reference)}
            disabled={done}
          >
            {actionIcon}
            {done ? '✅ Fait' : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const HubDubaiView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<HubSection>('reception');
  const [processed, setProcessed] = useState<Set<string>>(new Set());

  const handleAction = (ref: string) => {
    setProcessed(prev => new Set(prev).add(ref));
  };

  const sections: { key: HubSection; label: string; icon: React.ReactNode; orders: HubOrder[]; action: string; actionIcon: React.ReactNode }[] = [
    {
      key: 'reception',
      label: 'Réceptionner',
      icon: <Package size={18} />,
      orders: mockHubData.a_receptionner,
      action: 'Réceptionné ✅',
      actionIcon: <Package size={14} />,
    },
    {
      key: 'emballage',
      label: 'Emballer',
      icon: <BoxSelect size={18} />,
      orders: mockHubData.a_emballer,
      action: 'Emballé ✅',
      actionIcon: <BoxSelect size={14} />,
    },
    {
      key: 'expedition',
      label: 'Expédier',
      icon: <Truck size={18} />,
      orders: mockHubData.a_expedier,
      action: 'Expédié ✅',
      actionIcon: <Truck size={14} />,
    },
  ];

  const currentSection = sections.find(s => s.key === activeSection)!;
  const statusCounts = countByStatus(currentSection.orders);
  const nbDone = currentSection.orders.filter(o => processed.has(o.reference)).length;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Section Tabs */}
      <div className="grid grid-cols-3 gap-2">
        {sections.map(s => {
          const count = s.orders.length;
          const doneCount = s.orders.filter(o => processed.has(o.reference)).length;
          const isActive = activeSection === s.key;
          return (
            <button
              key={s.key}
              className={`btn ${isActive ? 'btn-primary' : 'btn-ghost bg-base-200'} flex-col h-auto py-3 gap-1`}
              onClick={() => setActiveSection(s.key)}
            >
              <div className="flex items-center gap-2">
                {s.icon}
                <span className="font-bold">{s.label}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={`badge badge-sm ${isActive ? 'badge-primary-content' : ''}`}>{count}</span>
                {doneCount > 0 && <span className="text-success">✅ {doneCount}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Status summary chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(statusCounts).map(([status, count]) => {
          const sc = statusConfig[status as ProductStatus];
          return (
            <div key={status} className={`badge gap-1 ${sc.class}`}>
              {sc.icon} {count} {sc.label}
            </div>
          );
        })}
        <div className="badge badge-outline gap-1">
          📦 {currentSection.orders.reduce((s, o) => s + o.produits.length, 0)} produits total
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <progress
          className="progress progress-primary flex-1"
          value={nbDone}
          max={currentSection.orders.length}
        />
        <span className="text-sm font-medium whitespace-nowrap">{nbDone}/{currentSection.orders.length} traités</span>
      </div>

      {/* Order cards */}
      <div className="flex flex-col gap-3">
        {currentSection.orders
          .sort((a, b) => {
            // Urgents first, then by age desc
            if (a.priorite === 'urgente' && b.priorite !== 'urgente') return -1;
            if (b.priorite === 'urgente' && a.priorite !== 'urgente') return 1;
            return b.jours - a.jours;
          })
          .map(order => (
            <OrderCard
              key={order.reference}
              order={order}
              actionLabel={currentSection.action}
              actionIcon={currentSection.actionIcon}
              onAction={handleAction}
              done={processed.has(order.reference)}
            />
          ))}
      </div>
    </div>
  );
};
