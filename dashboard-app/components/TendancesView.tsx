import React from 'react';
import { TrendingUp, TrendingDown, Target, Calendar, BarChart3, ArrowRight } from 'lucide-react';
import { mockHistoryData, mockForecastData } from '../data/mockData';
import { formatKMF, formatEUR } from '../utils/formatters';

const SHORT_MONTHS: Record<string, string> = {
  '01': 'Jan', '02': 'Fév', '03': 'Mar', '04': 'Avr',
  '05': 'Mai', '06': 'Juin', '07': 'Juil', '08': 'Aoû',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Déc',
};

function shortMonth(mois: string): string {
  const parts = mois.split('-');
  const m = SHORT_MONTHS[parts[1]] || parts[1];
  return `${m} ${parts[0].slice(2)}`;
}

export const TendancesView: React.FC = () => {
  const forecast = mockForecastData;
  const history = mockHistoryData.history;

  const progressPct = forecast.projection.attendu > 0
    ? Math.min(100, (forecast.realise_kmf / forecast.projection.attendu) * 100)
    : 0;

  // Bar chart values
  const maxCommandes = Math.max(...history.map((h) => Math.max(h.total_commandes, h.livrees)));

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* ROW 1: Forecast summary — 3 scenario cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Pessimiste */}
        <div className="card bg-base-200">
          <div className="card-body p-4 items-center text-center">
            <span className="badge badge-error badge-sm mb-1">Pessimiste</span>
            <TrendingDown size={24} className="opacity-60" />
            <div className="text-2xl font-bold mt-1">{formatKMF(forecast.projection.pessimiste)}</div>
            <div className="text-xs text-base-content/60">Projection fin de mois</div>
          </div>
        </div>
        {/* Attendu (highlighted) */}
        <div className="card bg-base-200 ring-2 ring-warning">
          <div className="card-body p-4 items-center text-center">
            <span className="badge badge-warning badge-sm mb-1">Attendu</span>
            <Target size={24} className="opacity-60" />
            <div className="text-3xl font-bold mt-1">{formatKMF(forecast.projection.attendu)}</div>
            <div className="text-xs text-base-content/60">Projection fin de mois</div>
          </div>
        </div>
        {/* Optimiste */}
        <div className="card bg-base-200">
          <div className="card-body p-4 items-center text-center">
            <span className="badge badge-success badge-sm mb-1">Optimiste</span>
            <TrendingUp size={24} className="opacity-60" />
            <div className="text-2xl font-bold mt-1">{formatKMF(forecast.projection.optimiste)}</div>
            <div className="text-xs text-base-content/60">Projection fin de mois</div>
          </div>
        </div>
      </div>

      {/* ROW 2: Progress card */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-bold text-lg flex items-center gap-2 mb-3">
            <BarChart3 size={20} className="opacity-60" />
            Réalisé ce mois
          </h3>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl font-bold">{formatKMF(forecast.realise_kmf)}</span>
            <ArrowRight size={16} className="opacity-60" />
            <span className="text-base-content/60">{formatKMF(forecast.projection.attendu)}</span>
          </div>
          <progress
            className="progress progress-primary w-full"
            value={progressPct}
            max={100}
          />
          <div className="flex items-center justify-between mt-2 text-sm">
            <span className="text-base-content/60">{progressPct.toFixed(1)}% atteint</span>
            <span className="badge badge-info badge-sm">
              <Calendar size={12} className="mr-1" />
              {forecast.days_remaining} jours restants
            </span>
          </div>
          <div className="flex gap-4 mt-3 text-sm text-base-content/60">
            <div>
              <span className="font-semibold text-base-content">Moy. CA/jour :</span>{' '}
              {formatKMF(forecast.modele.avg_ca_jour)}
            </div>
            <div>
              <span className="font-semibold text-base-content">Écart-type :</span>{' '}
              {formatKMF(forecast.modele.stddev)}
            </div>
          </div>
        </div>
      </div>

      {/* ROW 3: Historique mensuel — bar chart */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-bold text-lg flex items-center gap-2 mb-4">
            <BarChart3 size={20} className="opacity-60" />
            Évolution sur 6 mois
          </h3>
          {/* Div-based bar chart */}
          <div className="flex items-end gap-3 h-64">
            {history.map((m) => {
              const cmdPct = maxCommandes > 0 ? (m.total_commandes / maxCommandes) * 100 : 0;
              const livPct = maxCommandes > 0 ? (m.livrees / maxCommandes) * 100 : 0;
              return (
                <div key={m.mois} className="flex flex-col items-center flex-1 h-full">
                  {/* CA label */}
                  <span className="text-xs text-base-content/60 mb-1 truncate">
                    {formatKMF(m.ca_kmf).replace(' KMF', '')}
                  </span>
                  {/* Bars container */}
                  <div className="flex items-end gap-1 flex-1 w-full">
                    {/* Commandes bar */}
                    <div className="flex flex-col items-center flex-1 h-full justify-end">
                      <span className="text-xs font-bold mb-1">{m.total_commandes}</span>
                      <div
                        className="w-full bg-primary rounded-t"
                        style={{ height: `${cmdPct}%` }}
                      />
                    </div>
                    {/* Livrées bar */}
                    <div className="flex flex-col items-center flex-1 h-full justify-end">
                      <span className="text-xs font-bold mb-1">{m.livrees}</span>
                      <div
                        className="w-full bg-secondary rounded-t"
                        style={{ height: `${livPct}%` }}
                      />
                    </div>
                  </div>
                  {/* Month label */}
                  <span className="text-xs text-base-content/60 mt-2">{shortMonth(m.mois)}</span>
                </div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex gap-4 mt-3 justify-center">
            <div className="flex items-center gap-1 text-xs">
              <div className="w-3 h-3 bg-primary rounded" />
              <span className="text-base-content/60">Commandes</span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <div className="w-3 h-3 bg-secondary rounded" />
              <span className="text-base-content/60">Livrées</span>
            </div>
          </div>
        </div>
      </div>

      {/* ROW 4: Monthly comparison table */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-bold text-lg flex items-center gap-2 mb-3">
            <Calendar size={20} className="opacity-60" />
            Comparaison mensuelle
          </h3>
          <div className="overflow-x-auto">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>Mois</th>
                  <th className="text-right">Commandes</th>
                  <th className="text-right">Livrées</th>
                  <th className="text-center">Taux livraison</th>
                  <th className="text-right">CA KMF</th>
                  <th className="text-right">CA EUR</th>
                </tr>
              </thead>
              <tbody>
                {history.map((m) => {
                  const tauxLiv = m.total_commandes > 0
                    ? (m.livrees / m.total_commandes) * 100
                    : 0;
                  const tauxBadge =
                    tauxLiv >= 80 ? 'badge-success' :
                    tauxLiv >= 60 ? 'badge-warning' :
                    'badge-error';
                  return (
                    <tr key={m.mois}>
                      <td className="font-semibold">{shortMonth(m.mois)}</td>
                      <td className="text-right">{m.total_commandes}</td>
                      <td className="text-right">{m.livrees}</td>
                      <td className="text-center">
                        <span className={`badge ${tauxBadge} badge-sm`}>
                          {tauxLiv.toFixed(0)}%
                        </span>
                      </td>
                      <td className="text-right font-semibold">{formatKMF(m.ca_kmf)}</td>
                      <td className="text-right text-base-content/60">{formatEUR(m.ca_eur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
