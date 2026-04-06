import React from 'react';
import { Package, Truck, Clock, AlertTriangle } from 'lucide-react';
import { OpsData } from '../types';
import { formatKMF, statusColor, statusLabel, formatDays } from '../utils/formatters';
import { StatCard } from './StatCard';

interface OpsViewProps {
  data: OpsData;
}

const pipelineStatuses = ['confirmed', 'ordered', 'preparation', 'shipped', 'in_transit', 'available', 'collected', 'cancelled'] as const;

export const OpsView: React.FC<OpsViewProps> = ({ data }) => {
  return (
    <div className="space-y-6">
      {/* Today Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Nouvelles commandes" value={data.today.nouvelles_commandes} icon={<Package size={16} />} />
        <StatCard label="Scans effectués" value={data.today.scans_effectues} icon={<Truck size={16} />} />
        <StatCard label="Collectes" value={data.today.collectes} icon={<Package size={16} />} />
        <StatCard label="CA du jour" value={formatKMF(data.today.ca_kmf)} icon={<Package size={16} />} />
      </div>

      {/* Pipeline */}
      <div className="card bg-base-200 shadow-sm">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Package size={16} className="opacity-60" /> Pipeline des commandes
          </h3>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mt-3">
            {pipelineStatuses.map((status) => (
              <div key={status} className={`rounded-lg p-2 text-center ${statusColor(status)}`}>
                <div className="text-lg font-bold">{data.pipeline[status]}</div>
                <div className="text-[10px] leading-tight">{statusLabel(status)}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3 text-xs text-base-content/60">
            <span>🟢 Actif: <strong className="text-base-content">{data.pipeline.total_actif}</strong></span>
            <span>✅ Terminé: <strong className="text-base-content">{data.pipeline.total_termine}</strong></span>
          </div>
        </div>
      </div>

      {/* Bottlenecks */}
      <div className="card bg-base-200 shadow-sm">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <AlertTriangle size={16} className="text-warning opacity-80" /> Goulots d'étranglement
          </h3>
          <div className="overflow-x-auto mt-2">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Statut</th>
                  <th>Bloqué</th>
                  <th>Client</th>
                  <th>Relais</th>
                </tr>
              </thead>
              <tbody>
                {data.bottlenecks.map((b) => (
                  <tr key={b.reference}>
                    <td className="font-mono text-xs">{b.reference}</td>
                    <td><span className={`badge badge-sm ${statusColor(b.status)}`}>{statusLabel(b.status)}</span></td>
                    <td className="text-warning font-medium">{formatDays(b.jours_bloque)}</td>
                    <td>{b.client}</td>
                    <td className="text-xs text-base-content/60">{b.relais}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Hub Dubai */}
      <div className="card bg-base-200 shadow-sm">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Truck size={16} className="opacity-60" /> Hub Dubai
          </h3>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="text-center p-3 rounded-lg bg-warning/10">
              <div className="text-xl font-bold text-warning">{data.hub_dubai.en_preparation}</div>
              <div className="text-xs text-base-content/60">En préparation</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-primary/10">
              <div className="text-xl font-bold text-primary">{data.hub_dubai.expedies}</div>
              <div className="text-xs text-base-content/60">Expédiés</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-info/10">
              <div className="text-xl font-bold text-info">{data.hub_dubai.en_transit}</div>
              <div className="text-xs text-base-content/60">En transit</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
