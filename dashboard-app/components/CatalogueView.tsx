import React from 'react';
import { ShoppingBag, Tag, BarChart3, TrendingUp, Package } from 'lucide-react';
import { mockFinanceData, mockPilotageData, mockClientsData } from '../data/mockData';
import { formatKMF } from '../utils/formatters';
import { getStatusColor, getStatusLabel } from '../utils/formatters';
import { StatCard } from './StatCard';

const categoryEmoji: Record<string, string> = {
  ceremony: '👗',
  beauty: '💄',
  accessories: '⌚',
  electronics: '📱',
};

const categoryBadgeClass: Record<string, string> = {
  ceremony: 'badge-secondary',
  beauty: 'badge-primary',
  accessories: 'badge-warning',
  electronics: 'badge-info',
};

export const CatalogueView: React.FC = () => {
  const categories = mockPilotageData.categories;
  const pipeline = mockPilotageData.pipeline;
  const topProduits = mockClientsData.top_produits;

  const totalCategories = categories.length;
  const totalCommandes = categories.reduce((s, c) => s + c.nb_commandes, 0);
  const totalCA = categories.reduce((s, c) => s + c.ca_kmf, 0);
  const leader = categories.reduce((best, c) => (c.pct_ca || 0) > (best.pct_ca || 0) ? c : best, categories[0]);
  const leaderName = leader.categorie.charAt(0).toUpperCase() + leader.categorie.slice(1);

  // Pipeline distribution
  const pipelineTotal = pipeline.reduce((s, p) => s + p.nb, 0);

  // Map status to bg class
  const statusBgMap: Record<string, string> = {
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
      {/* ROW 1: Summary StatCards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Tag size={20} />} label="Total catégories" value={totalCategories} />
        <StatCard icon={<ShoppingBag size={20} />} label="Total commandes" value={totalCommandes} />
        <StatCard icon={<BarChart3 size={20} />} label="CA total" value={formatKMF(totalCA)} />
        <StatCard icon={<TrendingUp size={20} />} label="Catégorie leader" value={`${categoryEmoji[leader.categorie] || ''} ${leaderName}`} />
      </div>

      {/* ROW 2: Category cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {categories.map((cat) => {
          const name = cat.categorie.charAt(0).toUpperCase() + cat.categorie.slice(1);
          const emoji = categoryEmoji[cat.categorie] || '📦';
          const finCat = mockFinanceData.par_categorie.find((fc) => fc.categorie === cat.categorie);
          return (
            <div key={cat.categorie} className="card bg-base-200">
              <div className="card-body p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{emoji}</span>
                  <span className="text-lg font-bold">{name}</span>
                  {finCat?.taux_marge !== undefined && (
                    <span className="badge badge-ghost badge-sm ml-auto">Marge {finCat.taux_marge}%</span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                  <div>
                    <div className="text-base-content/60">Commandes</div>
                    <div className="font-bold">{cat.nb_commandes}</div>
                  </div>
                  <div>
                    <div className="text-base-content/60">Articles</div>
                    <div className="font-bold">{cat.nb_articles || '—'}</div>
                  </div>
                  <div>
                    <div className="text-base-content/60">CA</div>
                    <div className="font-bold">{formatKMF(cat.ca_kmf)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <progress
                    className="progress progress-primary flex-1"
                    value={cat.pct_ca || 0}
                    max={100}
                  />
                  <span className="text-sm font-semibold">{cat.pct_ca?.toFixed(1)}% CA</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ROW 3: Pipeline distribution */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-bold text-lg flex items-center gap-2 mb-3">
            <Package size={20} className="opacity-60" />
            Distribution pipeline
          </h3>
          {/* Stacked horizontal bar */}
          <div className="w-full rounded-lg overflow-hidden flex h-10">
            {pipeline.map((p) => {
              const pct = pipelineTotal > 0 ? (p.nb / pipelineTotal) * 100 : 0;
              if (pct === 0) return null;
              const bg = statusBgMap[p.statut] || 'bg-base-300';
              return (
                <div
                  key={p.statut}
                  className={`${bg} flex items-center justify-center text-xs font-bold`}
                  style={{ width: `${pct}%`, minWidth: pct > 3 ? undefined : '24px' }}
                  title={`${getStatusLabel(p.statut)}: ${p.nb}`}
                >
                  {pct > 8 ? p.nb : ''}
                </div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-3">
            {pipeline.map((p) => (
              <div key={p.statut} className="flex items-center gap-1 text-xs">
                <span className={`badge ${getStatusColor(p.statut)} badge-xs`} />
                <span className="text-base-content/60">{getStatusLabel(p.statut)} ({p.nb})</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ROW 4: Top produits table */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-bold text-lg flex items-center gap-2 mb-3">
            <TrendingUp size={20} className="opacity-60" />
            Top produits
          </h3>
          <div className="overflow-x-auto">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nom</th>
                  <th>Catégorie</th>
                  <th className="text-right">Qté</th>
                  <th className="text-right">Commandes</th>
                  <th className="text-right">CA</th>
                </tr>
              </thead>
              <tbody>
                {topProduits.map((p, i) => (
                  <tr key={p.nom}>
                    <td className="font-bold text-base-content/60">{i + 1}</td>
                    <td className="font-semibold">{p.nom}</td>
                    <td>
                      <span className={`badge ${categoryBadgeClass[p.categorie] || 'badge-ghost'} badge-sm`}>
                        {categoryEmoji[p.categorie] || ''} {p.categorie}
                      </span>
                    </td>
                    <td className="text-right">{p.qty}</td>
                    <td className="text-right">{p.nb_commandes ?? '—'}</td>
                    <td className="text-right font-semibold">{formatKMF(p.ca_kmf)}</td>
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
