import React from 'react';
import { DollarSign, TrendingUp, CreditCard, AlertTriangle, BarChart3 } from 'lucide-react';
import { mockFinanceData } from '../data/mockData';
import { formatKMF, formatEUR, formatPct } from '../utils/formatters';
import { StatCard } from './StatCard';

export const FinanceView: React.FC = () => {
  const { kpi, paiements, marges, par_categorie, top_produits, taux } = mockFinanceData;

  // Compute payment proportions
  const totalPaiements = paiements.cash.count + paiements.stripe.count;
  const cashPct = totalPaiements > 0 ? (paiements.cash.count / totalPaiements) * 100 : 50;
  const stripePct = 100 - cashPct;

  // Max CA for category bar chart
  const maxCaCat = Math.max(...par_categorie.map(c => c.ca_kmf));

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* ROW 1: KPI StatCards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<DollarSign size={24} />}
          label="CA KMF"
          value={formatKMF(kpi.ca_kmf)}
          trend={kpi.evolution.ca_pct}
        />
        <StatCard
          icon={<CreditCard size={24} />}
          label="CA EUR"
          value={formatEUR(kpi.ca_eur)}
          trend={kpi.evolution.ca_pct}
        />
        <StatCard
          icon={<BarChart3 size={24} />}
          label="Panier moyen"
          value={formatKMF(kpi.panier_moyen_kmf)}
        />
        <StatCard
          icon={<TrendingUp size={24} />}
          label="Taux marge"
          value={`${marges.taux_marge_pct}%`}
          className={marges.taux_marge_pct >= 30 ? '' : ''}
        />
      </div>

      {/* ROW 2: Paiements split */}
      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="card-title text-lg">
            <CreditCard size={20} className="opacity-60" />
            Répartition des paiements
          </h3>

          {/* Visual bar */}
          <div className="flex w-full h-8 rounded-lg overflow-hidden mt-2">
            <div
              className="bg-primary flex items-center justify-center text-primary-content text-sm font-bold"
              style={{ width: `${cashPct}%` }}
            >
              {cashPct.toFixed(0)}%
            </div>
            <div
              className="bg-secondary flex items-center justify-center text-secondary-content text-sm font-bold"
              style={{ width: `${stripePct}%` }}
            >
              {stripePct.toFixed(0)}%
            </div>
          </div>

          {/* Details below bar */}
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-primary" />
                <span className="font-semibold">Cash</span>
              </div>
              <div className="text-base-content/60 text-sm">
                {paiements.cash.count} paiements · {formatKMF(paiements.cash.total_kmf)}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-secondary" />
                <span className="font-semibold">Stripe</span>
              </div>
              <div className="text-base-content/60 text-sm">
                {paiements.stripe.count} paiements · {formatEUR(paiements.stripe.total_eur)}
              </div>
            </div>
          </div>

          {/* Taux de change */}
          <div className="divider my-1" />
          <div className="flex gap-4 text-sm text-base-content/60">
            <span>Taux EUR/KMF: <strong className="text-base-content">{taux.eur_kmf}</strong></span>
            <span>Taux AED/KMF: <strong className="text-base-content">{taux.aed_kmf}</strong></span>
          </div>
        </div>
      </div>

      {/* ROW 3: Marges + Par catégorie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Marges */}
        <div className="card bg-base-200">
          <div className="card-body">
            <h3 className="card-title text-lg">
              <TrendingUp size={20} className="opacity-60" />
              Marges
            </h3>

            <div className="flex flex-col gap-3 mt-2">
              <div className="flex justify-between items-center">
                <span className="text-base-content/60">Marge réelle</span>
                <span className={`font-bold ${marges.marge_reelle_kmf >= 0 ? 'text-success' : 'text-error'}`}>
                  {formatKMF(marges.marge_reelle_kmf)}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-base-content/60">Coûts logistique</span>
                <span className="font-bold">{formatKMF(marges.cout_logistique_kmf)}</span>
              </div>

              <div>
                <div className="flex justify-between text-sm text-base-content/60 mb-1">
                  <span>Avec coût renseigné</span>
                  <span>{marges.nb_avec_cost} / {marges.nb_avec_cost + marges.nb_sans_cost}</span>
                </div>
                <progress
                  className="progress progress-primary w-full"
                  value={marges.nb_avec_cost}
                  max={marges.nb_avec_cost + marges.nb_sans_cost}
                />
              </div>

              {/* Alertes perte */}
              {marges.alertes_perte.count > 0 && (
                <div className="alert alert-error">
                  <AlertTriangle size={18} />
                  <div>
                    <div className="font-bold">
                      {marges.alertes_perte.count} alerte{marges.alertes_perte.count > 1 ? 's' : ''} perte
                    </div>
                    <div className="text-sm">
                      Références: {marges.alertes_perte.refs.join(', ')}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: Par catégorie */}
        <div className="card bg-base-200">
          <div className="card-body">
            <h3 className="card-title text-lg">
              <BarChart3 size={20} className="opacity-60" />
              Par catégorie
            </h3>

            <div className="overflow-x-auto mt-2">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Catégorie</th>
                    <th>Cmd</th>
                    <th>CA</th>
                    <th>Marge</th>
                    <th>Taux</th>
                  </tr>
                </thead>
                <tbody>
                  {par_categorie.map(cat => (
                    <tr key={cat.categorie}>
                      <td>
                        <span className="badge badge-ghost badge-sm capitalize">{cat.categorie}</span>
                      </td>
                      <td>{cat.nb_commandes}</td>
                      <td className="text-sm">{formatKMF(cat.ca_kmf)}</td>
                      <td className="text-sm">{formatKMF(cat.marge_kmf || 0)}</td>
                      <td>
                        <span className={`badge badge-sm ${
                          (cat.taux_marge || 0) >= 30 ? 'badge-success' :
                          (cat.taux_marge || 0) >= 20 ? 'badge-warning' : 'badge-error'
                        }`}>
                          {cat.taux_marge || 0}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Visual CA bars */}
            <div className="flex flex-col gap-2 mt-3">
              {par_categorie.map(cat => (
                <div key={cat.categorie} className="flex items-center gap-2">
                  <span className="text-xs text-base-content/60 w-20 capitalize">{cat.categorie}</span>
                  <div className="flex-1 bg-base-300 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${maxCaCat > 0 ? (cat.ca_kmf / maxCaCat) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ROW 4: Top 5 produits */}
      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="card-title text-lg">
            <DollarSign size={20} className="opacity-60" />
            Top 5 produits
          </h3>

          <div className="overflow-x-auto mt-2">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Produit</th>
                  <th>Catégorie</th>
                  <th>Qté</th>
                  <th>CA</th>
                </tr>
              </thead>
              <tbody>
                {top_produits.map((prod, idx) => (
                  <tr key={prod.nom}>
                    <td>
                      <span className={`badge badge-sm ${idx === 0 ? 'badge-primary' : 'badge-ghost'}`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="font-semibold">{prod.nom}</td>
                    <td>
                      <span className="badge badge-ghost badge-sm capitalize">{prod.categorie}</span>
                    </td>
                    <td>{prod.qty}</td>
                    <td className="font-bold">{formatKMF(prod.ca_kmf)}</td>
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
