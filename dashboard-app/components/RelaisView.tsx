import React, { useState } from 'react';
import { MapPin, Phone, CheckCircle, Package, Users } from 'lucide-react';
import { mockOpsData, mockClientsData } from '../data/mockData';
import { formatKMF } from '../utils/formatters';
import { StatCard } from './StatCard';
import type { RelaisInfo, LogistiqueItem } from '../types';

type Island = 'Toutes' | 'Grande Comore' | 'Anjouan' | 'Mohéli';

const islandBadgeClass: Record<string, string> = {
  'Anjouan': 'badge-info',
  'Grande Comore': 'badge-success',
  'Mohéli': 'badge-warning',
};

export const RelaisView: React.FC = () => {
  const [selectedIsland, setSelectedIsland] = useState<Island>('Toutes');
  const [collectedItems, setCollectedItems] = useState<Set<string>>(new Set());

  const allRelais = mockClientsData.par_relais;
  const anjouanItems = mockOpsData.logistique.anjouan.items;

  // Count relays per island
  const islandCounts: Record<Island, number> = {
    'Toutes': allRelais.length,
    'Grande Comore': allRelais.filter(r => r.ile === 'Grande Comore').length,
    'Anjouan': allRelais.filter(r => r.ile === 'Anjouan').length,
    'Mohéli': allRelais.filter(r => r.ile === 'Mohéli').length,
  };

  // Filter relays
  const filteredRelais = selectedIsland === 'Toutes'
    ? allRelais
    : allRelais.filter(r => r.ile === selectedIsland);

  // Summary computations
  const totalCommandes = filteredRelais.reduce((s, r) => s + r.nb_commandes, 0);
  const totalLivrees = filteredRelais.reduce((s, r) => s + r.livrees, 0);
  const tauxCollecte = totalCommandes > 0 ? ((totalLivrees / totalCommandes) * 100).toFixed(1) : '0';

  // Get items at a specific relay (from Anjouan ops data)
  const getRelayItems = (relaisName: string): LogistiqueItem[] => {
    return anjouanItems.filter(item => item.relais_nom === relaisName);
  };

  const handleCollect = (reference: string) => {
    setCollectedItems(prev => {
      const next = new Set(prev);
      next.add(reference);
      return next;
    });
  };

  const handleCollectAll = (items: LogistiqueItem[]) => {
    setCollectedItems(prev => {
      const next = new Set(prev);
      items.forEach(item => next.add(item.reference));
      return next;
    });
  };

  const islands: Island[] = ['Toutes', 'Grande Comore', 'Anjouan', 'Mohéli'];

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Island Filter Tabs */}
      <div role="tablist" className="tabs tabs-boxed bg-base-200 p-1">
        {islands.map(island => (
          <a
            key={island}
            role="tab"
            className={`tab ${selectedIsland === island ? 'tab-active' : ''}`}
            onClick={() => setSelectedIsland(island)}
          >
            {island}
            <span className="badge badge-sm ml-2">{islandCounts[island]}</span>
          </a>
        ))}
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<Package size={24} />}
          label="Total commandes"
          value={totalCommandes}
        />
        <StatCard
          icon={<CheckCircle size={24} />}
          label="Livrées"
          value={totalLivrees}
        />
        <StatCard
          icon={<Users size={24} />}
          label="Taux de collecte"
          value={`${tauxCollecte}%`}
        />
      </div>

      {/* Relay Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredRelais.map((relay: RelaisInfo) => {
          const items = getRelayItems(relay.relais);
          const deliveryRate = relay.nb_commandes > 0
            ? (relay.livrees / relay.nb_commandes) * 100
            : 0;

          return (
            <div key={relay.relais} className="card bg-base-200">
              <div className="card-body">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin size={20} className="opacity-60" />
                    <h3 className="text-xl font-bold">{relay.relais}</h3>
                  </div>
                  <span className={`badge ${islandBadgeClass[relay.ile] || 'badge-ghost'}`}>
                    {relay.ile}
                  </span>
                </div>

                {/* Stats Row */}
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="badge badge-primary gap-1">
                    <Package size={12} /> {relay.nb_commandes} commandes
                  </span>
                  <span className="badge badge-success gap-1">
                    <CheckCircle size={12} /> {relay.livrees} livrées
                  </span>
                  <span className="badge badge-ghost">
                    {formatKMF(relay.ca_kmf)}
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="mt-2">
                  <div className="flex justify-between text-sm text-base-content/60 mb-1">
                    <span>Taux livraison</span>
                    <span>{deliveryRate.toFixed(0)}%</span>
                  </div>
                  <progress
                    className="progress progress-primary w-full"
                    value={deliveryRate}
                    max={100}
                  />
                </div>

                {/* Order Items Table (for relays with Anjouan ops items) */}
                {items.length > 0 && (
                  <div className="mt-3">
                    <h4 className="font-semibold text-sm text-base-content/60 mb-2">
                      Colis en attente
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="table table-zebra table-sm">
                        <thead>
                          <tr>
                            <th>Référence</th>
                            <th>Client</th>
                            <th>Heures attente</th>
                            <th>Statut</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(item => {
                            const isCollected = collectedItems.has(item.reference);
                            return (
                              <tr key={item.reference} className={isCollected ? 'opacity-50' : ''}>
                                <td className="font-mono font-bold">{item.reference}</td>
                                <td>{item.destinataire || '—'}</td>
                                <td>
                                  <span className={`badge badge-sm ${
                                    (item.heures_en_attente || 0) > 96 ? 'badge-error' :
                                    (item.heures_en_attente || 0) > 48 ? 'badge-warning' : 'badge-info'
                                  }`}>
                                    {item.heures_en_attente || 0}h
                                  </span>
                                </td>
                                <td>
                                  {isCollected ? (
                                    <span className="badge badge-success badge-sm">Collecté</span>
                                  ) : (
                                    <span className="badge badge-info badge-sm">{item.status}</span>
                                  )}
                                </td>
                                <td>
                                  <div className="flex gap-1">
                                    <button className="btn btn-info btn-sm" disabled={isCollected}>
                                      <Phone size={14} /> Contacter
                                    </button>
                                    <button
                                      className="btn btn-success btn-sm"
                                      disabled={isCollected}
                                      onClick={() => handleCollect(item.reference)}
                                    >
                                      <CheckCircle size={14} /> Collecté
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Bulk action */}
                    <div className="mt-2">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleCollectAll(items)}
                        disabled={items.every(i => collectedItems.has(i.reference))}
                      >
                        <CheckCircle size={16} /> Tout marquer collecté
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
