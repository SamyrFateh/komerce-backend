import React from 'react';
import { DollarSign, CreditCard, TrendingUp, AlertTriangle } from 'lucide-react';
import { FinanceData } from '../types';
import { formatKMF, formatEUR, formatPct } from '../utils/formatters';
import { StatCard } from './StatCard';

interface FinanceViewProps {
  data: FinanceData;
}

export const FinanceView: React.FC<FinanceViewProps> = ({ data }) => {
  return (
    <div className="space-y-6">
      {/* Period info */}
      <div className="text-xs text-base-content/50">
        Période: {data.period.start} → {data.period.end} ({data.period.days} jours)
      </div>

      {/* Revenue KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="CA (KMF)"
          value={formatKMF(data.revenue.ca_kmf)}
          trend={data.revenue.vs_previous.ca_pct}
          icon={<DollarSign size={16} />}
        />
        <StatCard
          label="CA (EUR)"
          value={formatEUR(data.revenue.ca_eur)}
          sub={`Taux: ${data.revenue.taux_eur_kmf} KMF/€`}
          icon={<DollarSign size={16} />}
        />
        <StatCard
          label="Commandes"
          value={data.revenue.nb_commandes}
          trend={data.revenue.vs_previous.nb_pct}
          icon={<CreditCard size={16} />}
        />
        <StatCard
          label="Panier moyen"
          value={formatKMF(data.revenue.panier_moyen_kmf)}
          icon={<TrendingUp size={16} />}
        />
      </div>

      {/* Payments Breakdown */}
      <div className="card bg-base-200 shadow-sm">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <CreditCard size={16} className="opacity-60" /> Répartition des paiements
          </h3>
          <div className="grid grid-cols-2 gap-4 mt-3">
            {/* Cash Relais */}
            <div className="p-3 rounded-lg bg-base-300">
              <div className="text-xs text-base-content/60 mb-1">💵 Cash Relais</div>
              <div className="text-lg font-bold">{formatKMF(data.payments.cash_relais.total_kmf)}</div>
              <div className="flex justify-between text-xs text-base-content/50 mt-1">
                <span>{data.payments.cash_relais.count} paiements</span>
                <span className="font-medium">{data.payments.cash_relais.pct}%</span>
              </div>
              <progress className="progress progress-primary w-full mt-1" value={data.payments.cash_relais.pct} max={100} />
            </div>
            {/* Stripe EUR */}
            <div className="p-3 rounded-lg bg-base-300">
              <div className="text-xs text-base-content/60 mb-1">💳 Stripe EUR</div>
              <div className="text-lg font-bold">{formatKMF(data.payments.stripe_eur.total_kmf)}</div>
              <div className="flex justify-between text-xs text-base-content/50 mt-1">
                <span>{data.payments.stripe_eur.count} paiements</span>
                <span className="font-medium">{data.payments.stripe_eur.pct}%</span>
              </div>
              <progress className="progress progress-secondary w-full mt-1" value={data.payments.stripe_eur.pct} max={100} />
            </div>
          </div>
          <div className="flex gap-4 mt-3 text-xs">
            <span className="text-success">✅ Confirmés: {data.payments.confirmed.count} ({formatKMF(data.payments.confirmed.total_kmf)})</span>
            <span className="text-warning">⏳ En attente: {data.payments.pending.count} ({formatKMF(data.payments.pending.total_kmf)})</span>
          </div>
        </div>
      </div>

      {/* Margins */}
      <div className="card bg-base-200 shadow-sm">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <TrendingUp size={16} className="opacity-60" /> Analyse des marges
          </h3>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="text-center p-3 rounded-lg bg-base-300">
              <div className="text-xs text-base-content/60">Marge estimée</div>
              <div className="text-xl font-bold text-primary">{formatPct(data.margins.avg_estimated_pct, false)}</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-base-300">
              <div className="text-xs text-base-content/60">Marge réelle</div>
              <div className="text-xl font-bold text-secondary">{formatPct(data.margins.avg_real_pct, false)}</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-base-300">
              <div className="text-xs text-base-content/60">Écart</div>
              <div className={`text-xl font-bold ${data.margins.gap_pct < 0 ? 'text-error' : 'text-success'}`}>
                {formatPct(data.margins.gap_pct)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-base-content/60">Marge totale</span>
              <span className="font-medium">{formatKMF(data.margins.total_margin_kmf)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-base-content/60">Transport</span>
              <span className="font-medium">{formatKMF(data.margins.transport_kmf)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-base-content/60">Douane</span>
              <span className="font-medium">{formatKMF(data.margins.douane_kmf)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-base-content/60">Chiffrées / Non chiffrées</span>
              <span className="font-medium">{data.margins.orders_costed} / {data.margins.orders_not_costed}</span>
            </div>
          </div>

          {data.margins.alerts.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-error flex items-center gap-1 mb-1">
                <AlertTriangle size={12} /> Alertes marges
              </div>
              {data.margins.alerts.map((a) => (
                <div key={a.reference} className="text-xs bg-error/10 text-error rounded p-2 mb-1">
                  <span className="font-mono">{a.reference}</span> — Marge: {formatPct(a.margin_real_pct)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Monthly Trend */}
      <div className="card bg-base-200 shadow-sm">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <TrendingUp size={16} className="opacity-60" /> Tendance mensuelle
          </h3>
          <div className="overflow-x-auto mt-2">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Mois</th>
                  <th>CA (KMF)</th>
                  <th>Commandes</th>
                  <th>Marge</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly_trend.map((m) => (
                  <tr key={m.mois}>
                    <td className="font-medium">{m.mois}</td>
                    <td>{formatKMF(m.ca_kmf)}</td>
                    <td>{m.nb}</td>
                    <td><span className="badge badge-sm badge-primary">{formatPct(m.marge_pct, false)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
