import React from 'react';
import { Users, UserCheck, Repeat, ShoppingBag, MapPin } from 'lucide-react';
import { mockClientsData } from '../data/mockData';
import { formatKMF, formatPct, formatDate } from '../utils/formatters';
import { StatCard } from './StatCard';
import { api } from '../utils/api';
import { useApi } from '../utils/useApi';
import { LoadingError } from './LoadingError';

const islandBadgeClass: Record<string, string> = {
  'Anjouan': 'badge-info',
  'Grande Comore': 'badge-success',
  'Mohéli': 'badge-warning',
};

/** Format month string "2026-01" to short French label */
function formatMonth(mois: string): string {
  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  const parts = mois.split('-');
  if (parts.length < 2) return mois;
  const monthIdx = parseInt(parts[1], 10) - 1;
  return `${monthNames[monthIdx] || parts[1]} ${parts[0].slice(2)}`;
}

export const ClientsView: React.FC = () => {
  const { data: clientsData, loading, error, reload, usingMock } = useApi(() => api.clients(), mockClientsData, 15000);
  const { kpi, top_clients, evolution, par_relais } = clientsData!;

  // Bar chart: max value for scaling
  const maxCommandes = Math.max(...evolution.map(e => e.nb_commandes));

  return (
    <div className="flex flex-col gap-4 p-4">
      <LoadingError loading={loading} error={error} usingMock={usingMock} reload={reload} />
      {!loading && clientsData && (
        <>
          {/* ROW 1: KPI StatCards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={<Users size={24} />}
              label="Clients"
              value={kpi.nb_clients}
            />
            <StatCard
              icon={<UserCheck size={24} />}
              label="Récurrents"
              value={kpi.clients_recurrents}
            />
            <StatCard
              icon={<Repeat size={24} />}
              label="Taux récurrence"
              value={formatPct(kpi.taux_recurrence_pct)}
            />
            <StatCard
              icon={<ShoppingBag size={24} />}
              label="Panier moyen"
              value={formatKMF(kpi.panier_moyen_kmf)}
            />
          </div>

          {/* ROW 2: Top clients + Évolution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* LEFT: Top clients table */}
            <div className="card bg-base-200">
              <div className="card-body">
                <h3 className="card-title text-lg">
                  <Users size={20} className="opacity-60" />
                  Top clients
                </h3>

                <div className="overflow-x-auto mt-2">
                  <table className="table table-zebra table-sm">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Nom</th>
                        <th>Téléphone</th>
                        <th>Cmd</th>
                        <th>CA</th>
                        <th>Dernière cmd</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top_clients.map((client, idx) => (
                        <tr key={client.name} className={idx === 0 ? 'bg-primary/10' : ''}>
                          <td>
                            <span className={`badge badge-sm ${idx === 0 ? 'badge-primary' : 'badge-ghost'}`}>
                              {idx + 1}
                            </span>
                          </td>
                          <td className="font-semibold">{client.name}</td>
                          <td className="text-base-content/60 text-sm">{client.phone}</td>
                          <td>{client.nb_commandes}</td>
                          <td className="font-bold text-sm">{formatKMF(client.ca_kmf)}</td>
                          <td className="text-base-content/60 text-sm">{formatDate(client.derniere_commande)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* RIGHT: Évolution mensuelle bar chart */}
            <div className="card bg-base-200">
              <div className="card-body">
                <h3 className="card-title text-lg">
                  <Repeat size={20} className="opacity-60" />
                  Évolution mensuelle
                </h3>

                <div className="flex items-end gap-3 h-48 mt-4 px-2">
                  {evolution.map(month => {
                    const heightPct = maxCommandes > 0
                      ? (month.nb_commandes / maxCommandes) * 100
                      : 0;
                    return (
                      <div key={month.mois} className="flex flex-col items-center flex-1">
                        <span className="text-sm font-bold mb-1">{month.nb_commandes}</span>
                        <div className="w-full flex items-end justify-center" style={{ height: '140px' }}>
                          <div
                            className="w-full max-w-12 bg-primary rounded-t"
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>
                        <span className="text-xs text-base-content/60 mt-2">{formatMonth(month.mois)}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="text-center text-xs text-base-content/60 mt-2">
                  Nombre de commandes par mois
                </div>
              </div>
            </div>
          </div>

          {/* ROW 3: Par relais */}
          <div className="card bg-base-200">
            <div className="card-body">
              <h3 className="card-title text-lg">
                <MapPin size={20} className="opacity-60" />
                Par relais
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                {par_relais.map(relay => {
                  const deliveryRate = relay.nb_commandes > 0
                    ? (relay.livrees / relay.nb_commandes) * 100
                    : 0;
                  return (
                    <div key={relay.relais} className="card bg-base-300">
                      <div className="card-body p-4">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-sm">{relay.relais}</h4>
                          <span className={`badge badge-sm ${islandBadgeClass[relay.ile] || 'badge-ghost'}`}>
                            {relay.ile}
                          </span>
                        </div>

                        <div className="flex flex-col gap-1 mt-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-base-content/60">Commandes</span>
                            <span className="font-bold">{relay.nb_commandes}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-base-content/60">CA</span>
                            <span className="font-bold">{formatKMF(relay.ca_kmf)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-base-content/60">Livrées</span>
                            <span className="font-bold">{relay.livrees}</span>
                          </div>
                        </div>

                        <div className="mt-2">
                          <div className="flex justify-between text-xs text-base-content/60 mb-1">
                            <span>Taux livraison</span>
                            <span>{deliveryRate.toFixed(0)}%</span>
                          </div>
                          <progress
                            className="progress progress-primary w-full"
                            value={deliveryRate}
                            max={100}
                          />
                        </div>
                      </div>
                    </div>
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
