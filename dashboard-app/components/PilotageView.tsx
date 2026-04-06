import React from 'react';
import { Target, Users, ShoppingBag, Activity, TrendingUp } from 'lucide-react';
import { PilotageData } from '../types';
import { formatKMF, formatPct, formatDate } from '../utils/formatters';
import { StatCard } from './StatCard';

interface PilotageViewProps {
  data: PilotageData;
}

export const PilotageView: React.FC<PilotageViewProps> = ({ data }) => {
  const healthColor = data.pipeline_health.score >= 80 ? 'text-success' : data.pipeline_health.score >= 60 ? 'text-warning' : 'text-error';
  const healthProgressColor = data.pipeline_health.score >= 80 ? 'progress-success' : data.pipeline_health.score >= 60 ? 'progress-warning' : 'progress-error';

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Clients actifs (30j)" value={data.kpi.clients_actifs_30j} icon={<Users size={16} />} />
        <StatCard label="Nouveaux clients" value={data.kpi.clients_nouveaux_30j} icon={<Users size={16} />} />
        <StatCard label="Taux de réachat" value={formatPct(data.kpi.taux_reachat_pct, false)} icon={<Target size={16} />} />
        <StatCard label="Taux livraison" value={formatPct(data.kpi.taux_livraison_pct, false)} icon={<ShoppingBag size={16} />} />
        <StatCard label="Taux annulation" value={formatPct(data.kpi.taux_annulation_pct, false)} icon={<Activity size={16} />} />
        <StatCard label="Délai moyen" value={`${data.kpi.delai_moyen_jours}j`} icon={<Activity size={16} />} />
      </div>

      {/* Pipeline Health */}
      <div className="card bg-base-200 shadow-sm">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Activity size={16} className="opacity-60" /> Santé du pipeline
          </h3>
          <div className="flex items-center gap-4 mt-3">
            <div className={`text-4xl font-bold ${healthColor}`}>{data.pipeline_health.score}</div>
            <div className="flex-1">
              <progress className={`progress ${healthProgressColor} w-full`} value={data.pipeline_health.score} max={100} />
              <div className="text-xs text-base-content/50 mt-1">Score de santé sur 100</div>
            </div>
          </div>
          {data.pipeline_health.issues.length > 0 && (
            <div className="mt-3 space-y-1">
              {data.pipeline_health.issues.map((issue, i) => (
                <div key={i} className="text-xs bg-warning/10 text-warning rounded p-2">
                  ⚠️ {issue}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Products & Categories */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Top Products */}
        <div className="card bg-base-200 shadow-sm">
          <div className="card-body p-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ShoppingBag size={16} className="opacity-60" /> Top produits
            </h3>
            <div className="space-y-2 mt-3">
              {data.top_products.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-base-content/40 w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-base-content/50">{p.nb_commandes} cmd — {formatKMF(p.ca_kmf)}</div>
                  </div>
                  <span className="badge badge-sm badge-primary">{p.category}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Categories */}
        <div className="card bg-base-200 shadow-sm">
          <div className="card-body p-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Target size={16} className="opacity-60" /> Catégories
            </h3>
            <div className="space-y-3 mt-3">
              {data.top_categories.map((c) => (
                <div key={c.category}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium capitalize">{c.category}</span>
                    <span className="text-base-content/60">{formatPct(c.pct_ca, false)}</span>
                  </div>
                  <progress className="progress progress-primary w-full" value={c.pct_ca} max={100} />
                  <div className="text-xs text-base-content/50 mt-0.5">
                    {c.nb_commandes} cmd — {formatKMF(c.ca_kmf)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Top Clients */}
      <div className="card bg-base-200 shadow-sm">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Users size={16} className="opacity-60" /> Top clients
          </h3>
          <div className="text-xs text-base-content/50 mt-1">
            {data.clients.total} total — {data.clients.actifs_30j} actifs (30j) — {data.clients.actifs_90j} actifs (90j)
          </div>
          <div className="overflow-x-auto mt-2">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Commandes</th>
                  <th>CA (KMF)</th>
                  <th>Dernière cmd</th>
                </tr>
              </thead>
              <tbody>
                {data.clients.top_clients.map((c) => (
                  <tr key={c.name}>
                    <td className="font-medium">{c.name}</td>
                    <td>{c.nb_commandes}</td>
                    <td>{formatKMF(c.ca_kmf)}</td>
                    <td className="text-xs text-base-content/60">{formatDate(c.derniere_commande)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Forecast */}
      <div className="card bg-base-200 shadow-sm">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <TrendingUp size={16} className="opacity-60" /> Prévision 30 jours
          </h3>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold text-primary">{formatKMF(data.forecast_30j.ca_estime_kmf)}</span>
          </div>
          <div className="text-xs text-base-content/50 mt-1">
            Méthode: {data.forecast_30j.methode}
          </div>
        </div>
      </div>
    </div>
  );
};
