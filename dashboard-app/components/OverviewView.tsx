import React from 'react';
import { Package, CheckCircle, AlertTriangle, DollarSign, Clock, Banknote, Bug, PackageX, ArrowRight } from 'lucide-react';
import { mockOpsData, mockFinanceData, mockPilotageData } from '../data/mockData';
import { formatKMF, getStatusLabel, getStatusColor } from '../utils/formatters';
import { StatCard } from './StatCard';
import { api } from '../utils/api';
import { useApi } from '../utils/useApi';
import { LoadingError } from './LoadingError';

const PIPELINE_STATUSES = ['confirmed', 'ordered', 'preparation', 'shipped', 'in_transit', 'available', 'collected', 'cancelled', 'refunded'] as const;

const STEP_KEYS = ['dubai_reception', 'dubai_expedition', 'transitaire', 'bateau', 'anjouan'] as const;

const STEP_ICONS = ['📥', '📦', '🏢', '🚢', '📍'];

export const OverviewView: React.FC = () => {
  const { data: ops, loading: l1, error: e1, reload: r1, usingMock: m1 } = useApi(() => api.ops(), mockOpsData, 15000);
  const { data: finance, loading: l2, error: e2, reload: r2, usingMock: m2 } = useApi(() => api.finance(), mockFinanceData, 15000);
  const { data: pilotage, loading: l3, error: e3, reload: r3, usingMock: m3 } = useApi(() => api.pilotage(), mockPilotageData, 15000);

  const loading = l1 || l2 || l3;
  const error = e1 || e2 || e3;
  const usingMock = m1 || m2 || m3;
  const reload = () => { r1(); r2(); r3(); };

  // Health score
  const slaTotal = ops!.sla.on_time + ops!.sla.warning + ops!.sla.late + ops!.sla.blocked;
  const healthScore = slaTotal > 0 ? Math.round((ops!.sla.on_time / slaTotal) * 100) : 0;

  const healthColor = healthScore >= 80 ? 'text-success' : healthScore >= 60 ? 'text-warning' : 'text-error';
  const healthBadge = healthScore >= 80 ? 'badge-success' : healthScore >= 60 ? 'badge-warning' : 'badge-error';

  // Pipeline status counts from pilotage
  const pipelineCounts: Record<string, number> = {};
  pilotage!.pipeline.forEach(p => { pipelineCounts[p.statut] = p.nb; });
  const pipelineTotal = pilotage!.pipeline.reduce((sum, p) => sum + p.nb, 0);

  // Pipeline bar colors
  const pipelineBarColor: Record<string, string> = {
    confirmed: 'bg-info',
    ordered: 'bg-info',
    preparation: 'bg-warning',
    shipped: 'bg-primary',
    in_transit: 'bg-primary',
    available: 'bg-success',
    collected: 'bg-success',
    cancelled: 'bg-error',
    refunded: 'bg-error',
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <LoadingError loading={loading} error={error} usingMock={usingMock} reload={reload} />
      {!loading && ops && finance && pilotage && (
        <>
          {/* Row 1: StatCards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={<Package size={20} />}
              label="Commandes aujourd'hui"
              value={ops.activite.commandes_aujourd_hui}
            />
            <StatCard
              icon={<CheckCircle size={20} />}
              label="Livrées aujourd'hui"
              value={ops.activite.livrees_aujourd_hui}
            />
            <StatCard
              icon={<AlertTriangle size={20} />}
              label="Bloquées"
              value={ops.activite.commandes_bloquees}
              className="ring-1 ring-error/30"
            />
            <StatCard
              icon={<DollarSign size={20} />}
              label="CA 30j"
              value={formatKMF(finance.kpi.ca_kmf)}
            />
          </div>

          {/* Row 2: Health Score + SLA Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Health Score */}
            <div className="card bg-base-200">
              <div className="card-body p-4 flex flex-row items-center gap-6">
                <div
                  className={`radial-progress ${healthColor}`}
                  style={{ '--value': healthScore, '--size': '6rem', '--thickness': '0.5rem' } as React.CSSProperties}
                  role="progressbar"
                >
                  <span className="text-xl font-bold">{healthScore}%</span>
                </div>
                <div>
                  <div className="text-lg font-bold">Score Santé</div>
                  <div className="text-base-content/60 text-sm">
                    Basé sur le ratio SLA à temps
                  </div>
                  <span className={`badge ${healthBadge} mt-2`}>
                    {healthScore >= 80 ? 'Bon' : healthScore >= 60 ? 'Attention' : 'Critique'}
                  </span>
                </div>
              </div>
            </div>

            {/* SLA Breakdown */}
            <div className="card bg-base-200">
              <div className="card-body p-4">
                <div className="text-sm font-bold mb-3">Répartition SLA</div>
                <div className="grid grid-cols-4 gap-2">
                  <div className="card bg-base-300">
                    <div className="card-body p-3 items-center text-center">
                      <span className="badge badge-success badge-sm">À temps</span>
                      <div className="text-xl font-bold">{ops.sla.on_time}</div>
                    </div>
                  </div>
                  <div className="card bg-base-300">
                    <div className="card-body p-3 items-center text-center">
                      <span className="badge badge-warning badge-sm">Attention</span>
                      <div className="text-xl font-bold">{ops.sla.warning}</div>
                    </div>
                  </div>
                  <div className="card bg-base-300">
                    <div className="card-body p-3 items-center text-center">
                      <span className="badge badge-error badge-sm">En retard</span>
                      <div className="text-xl font-bold">{ops.sla.late}</div>
                    </div>
                  </div>
                  <div className="card bg-base-300">
                    <div className="card-body p-3 items-center text-center">
                      <span className="badge badge-error badge-sm">Bloquées</span>
                      <div className="text-xl font-bold">{ops.sla.blocked}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Alertes */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="alert alert-warning">
              <Banknote size={20} />
              <div>
                <div className="font-bold">Cash en attente</div>
                <div className="text-sm">{ops.alertes.cash_pending} paiement(s) à encaisser</div>
              </div>
            </div>
            <div className="alert alert-error">
              <Bug size={20} />
              <div>
                <div className="font-bold">Anomalies</div>
                <div className="text-sm">{ops.alertes.anomalies} anomalie(s) détectée(s)</div>
              </div>
            </div>
            <div className="alert alert-warning">
              <PackageX size={20} />
              <div>
                <div className="font-bold">Stock bas</div>
                <div className="text-sm">{ops.alertes.low_stock} produit(s) en rupture</div>
              </div>
            </div>
          </div>

          {/* Row 4: Mini pipeline bar */}
          <div className="card bg-base-200">
            <div className="card-body p-4">
              <div className="text-sm font-bold mb-2">Pipeline des commandes</div>
              <div className="flex w-full h-8 rounded-lg overflow-hidden">
                {PIPELINE_STATUSES.map(status => {
                  const count = pipelineCounts[status] || 0;
                  if (count === 0) return null;
                  const pct = (count / pipelineTotal) * 100;
                  return (
                    <div
                      key={status}
                      className={`${pipelineBarColor[status]} flex items-center justify-center text-xs font-bold`}
                      style={{ width: `${pct}%`, minWidth: count > 0 ? '24px' : '0' }}
                      title={`${getStatusLabel(status)}: ${count}`}
                    >
                      {pct > 6 ? count : ''}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                {PIPELINE_STATUSES.map(status => {
                  const count = pipelineCounts[status] || 0;
                  if (count === 0) return null;
                  return (
                    <div key={status} className="flex items-center gap-1 text-xs">
                      <span className={`badge ${getStatusColor(status)} badge-xs`}>&nbsp;</span>
                      <span className="text-base-content/60">{getStatusLabel(status)}: {count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Row 5: Logistics quick view */}
          <div className="card bg-base-200">
            <div className="card-body p-4">
              <div className="text-sm font-bold mb-3">Chaîne logistique</div>
              <div className="flex items-center justify-between gap-2">
                {STEP_KEYS.map((key, idx) => {
                  const step = ops.logistique[key];
                  return (
                    <React.Fragment key={key}>
                      <div className="flex flex-col items-center flex-1">
                        <span className="text-2xl">{STEP_ICONS[idx]}</span>
                        <span className="text-2xl font-bold mt-1">{step.count}</span>
                        <span className="text-xs text-base-content/60 text-center mt-1">
                          {step.label.replace(/^[^\s]+\s/, '')}
                        </span>
                      </div>
                      {idx < STEP_KEYS.length - 1 && (
                        <ArrowRight size={16} className="opacity-40 flex-shrink-0" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
