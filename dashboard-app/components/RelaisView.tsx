import React, { useState } from 'react';
import { ClipboardCheck, HandCoins, Phone, AlertTriangle, CheckCircle, Clock, XCircle, Ban, HelpCircle, ChevronDown, ChevronUp, CreditCard, Banknote } from 'lucide-react';
import { mockRelaisOrders } from '../data/mockData';
import { formatKMF } from '../utils/formatters';
import type { RelaisOrder, OrderProduct, ProductStatus } from '../types';

type RelaisSection = 'valider' | 'remettre';

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
  if (allOk) return { label: '✅ Tout OK', class: 'text-success' };
  const hasBlocking = active.some(p => ['hors_stock', 'defectueux', 'retard'].includes(p.status));
  if (hasBlocking) return { label: '⚠️ Problème', class: 'text-error' };
  return { label: '⏳ Partiel', class: 'text-warning' };
}

function formatWait(heures: number): string {
  if (heures < 24) return `${heures}h`;
  const jours = Math.floor(heures / 24);
  return `${jours}j ${heures % 24}h`;
}

function waitUrgency(heures: number): string {
  if (heures > 120) return 'text-error font-bold';
  if (heures > 48) return 'text-warning font-semibold';
  return 'text-base-content';
}

const RelaisOrderCard: React.FC<{
  order: RelaisOrder;
  section: RelaisSection;
  onAction: (ref: string) => void;
  done: boolean;
}> = ({ order, section, onAction, done }) => {
  const [expanded, setExpanded] = useState(false);
  const globalStatus = getOrderGlobalStatus(order.produits);
  const nbComplet = order.produits.filter(p => p.status === 'complet').length;
  const nbTotal = order.produits.length;
  const hasIssue = order.produits.some(p => !['complet', 'annule'].includes(p.status));

  return (
    <div className={`card bg-base-200 ${done ? 'opacity-50' : ''} ${order.priorite === 'urgente' ? 'border-l-4 border-error' : ''} ${order.heures_attente > 120 ? 'border-r-4 border-warning' : ''}`}>
      <div className="card-body p-4 gap-2">
        {/* Header row */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-primary">{order.reference}</span>
            {order.priorite === 'urgente' && <span className="badge badge-error badge-sm">URGENT</span>}
            <span className={`text-sm font-semibold ${globalStatus.class}`}>{globalStatus.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${waitUrgency(order.heures_attente)}`}>
              ⏱️ {formatWait(order.heures_attente)}
            </span>
          </div>
        </div>

        {/* Client info row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-medium">{order.client_nom}</span>
          <a href={`tel:${order.client_phone}`} className="link link-hover text-sm flex items-center gap-1">
            <Phone size={12} /> {order.client_phone}
          </a>
          <span className="text-sm opacity-60">📍 {order.relais_nom}</span>
          <span className="text-sm opacity-60">🏝️ {order.ile}</span>
        </div>

        {/* Payment & total */}
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold">{formatKMF(order.total_kmf)}</span>
          <span className={`badge badge-sm gap-1 ${order.payment_mode === 'stripe' ? 'badge-info' : 'badge-warning'}`}>
            {order.payment_mode === 'stripe' ? <CreditCard size={12} /> : <Banknote size={12} />}
            {order.payment_mode === 'stripe' ? 'Stripe' : 'Cash'}
          </span>
          <span className={`badge badge-sm ${order.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}`}>
            {order.payment_status === 'paid' ? '✅ Payé' : '💰 À encaisser'}
          </span>
        </div>

        {/* Products toggle */}
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

        {/* Expanded product table */}
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

        {/* Action buttons */}
        <div className="flex items-center justify-between mt-1 flex-wrap gap-2">
          {section === 'remettre' && order.payment_status === 'pending' && !done && (
            <span className="text-warning text-sm font-semibold">💰 Encaisser {formatKMF(order.total_kmf)} avant remise</span>
          )}
          <div className="flex gap-2 ml-auto">
            <a href={`tel:${order.client_phone}`} className="btn btn-sm btn-ghost">
              <Phone size={14} /> Appeler
            </a>
            <button
              className={`btn btn-sm ${done ? 'btn-disabled' : section === 'valider' ? 'btn-primary' : 'btn-success'}`}
              onClick={() => !done && onAction(order.reference)}
              disabled={done}
            >
              {section === 'valider' ? <ClipboardCheck size={14} /> : <HandCoins size={14} />}
              {done ? '✅ Fait' : section === 'valider' ? 'Valider' : 'Colis remis'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const RelaisView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<RelaisSection>('valider');
  const [processed, setProcessed] = useState<Set<string>>(new Set());
  const [filterRelais, setFilterRelais] = useState<string>('Tous');

  const handleAction = (ref: string) => {
    setProcessed(prev => new Set(prev).add(ref));
  };

  const allOrders = activeSection === 'valider' ? mockRelaisOrders.a_valider : mockRelaisOrders.a_remettre;

  // Get unique relais names
  const allRelaisNames = [...new Set([...mockRelaisOrders.a_valider, ...mockRelaisOrders.a_remettre].map(o => o.relais_nom))];

  const filteredOrders = filterRelais === 'Tous' ? allOrders : allOrders.filter(o => o.relais_nom === filterRelais);

  const nbDone = filteredOrders.filter(o => processed.has(o.reference)).length;

  const sections: { key: RelaisSection; label: string; icon: React.ReactNode; count: number }[] = [
    { key: 'valider', label: 'Valider commandes', icon: <ClipboardCheck size={20} />, count: mockRelaisOrders.a_valider.length },
    { key: 'remettre', label: 'Remettre colis', icon: <HandCoins size={20} />, count: mockRelaisOrders.a_remettre.length },
  ];

  // Cash à encaisser
  const cashPending = filteredOrders
    .filter(o => o.payment_status === 'pending' && !processed.has(o.reference))
    .reduce((s, o) => s + o.total_kmf, 0);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Section Tabs — 2 big buttons */}
      <div className="grid grid-cols-2 gap-3">
        {sections.map(s => {
          const isActive = activeSection === s.key;
          const doneCount = (s.key === 'valider' ? mockRelaisOrders.a_valider : mockRelaisOrders.a_remettre)
            .filter(o => processed.has(o.reference)).length;
          return (
            <button
              key={s.key}
              className={`btn btn-lg ${isActive ? (s.key === 'valider' ? 'btn-primary' : 'btn-success') : 'btn-ghost bg-base-200'} flex-col h-auto py-4 gap-1`}
              onClick={() => setActiveSection(s.key)}
            >
              {s.icon}
              <span className="font-bold text-sm">{s.label}</span>
              <div className="flex gap-2 text-xs">
                <span className="badge badge-sm">{s.count}</span>
                {doneCount > 0 && <span className="text-success">✅ {doneCount}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Relais filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">📍 Relais :</span>
        <select
          className="select select-sm select-bordered"
          value={filterRelais}
          onChange={(e) => setFilterRelais(e.target.value)}
        >
          <option value="Tous">Tous ({allOrders.length})</option>
          {allRelaisNames.map(name => {
            const count = allOrders.filter(o => o.relais_nom === name).length;
            return <option key={name} value={name}>{name} ({count})</option>;
          })}
        </select>

        {cashPending > 0 && (
          <span className="badge badge-warning gap-1 ml-auto">
            <Banknote size={14} /> Cash à encaisser : {formatKMF(cashPending)}
          </span>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center gap-3">
        <progress
          className={`progress flex-1 ${activeSection === 'valider' ? 'progress-primary' : 'progress-success'}`}
          value={nbDone}
          max={filteredOrders.length}
        />
        <span className="text-sm font-medium whitespace-nowrap">{nbDone}/{filteredOrders.length} traités</span>
      </div>

      {/* Order cards */}
      <div className="flex flex-col gap-3">
        {filteredOrders.length === 0 ? (
          <div className="text-center py-8 opacity-60">Aucune commande dans cette section pour ce relais</div>
        ) : (
          filteredOrders
            .sort((a, b) => {
              // Urgents first, then longest wait first
              if (a.priorite === 'urgente' && b.priorite !== 'urgente') return -1;
              if (b.priorite === 'urgente' && a.priorite !== 'urgente') return 1;
              return b.heures_attente - a.heures_attente;
            })
            .map(order => (
              <RelaisOrderCard
                key={order.reference}
                order={order}
                section={activeSection}
                onAction={handleAction}
                done={processed.has(order.reference)}
              />
            ))
        )}
      </div>
    </div>
  );
};
