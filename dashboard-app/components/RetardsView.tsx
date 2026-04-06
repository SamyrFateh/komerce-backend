import React, { useState } from 'react';
import { AlertTriangle, Clock, MessageSquare, Mail, CheckCircle, Shield, Phone } from 'lucide-react';
import { mockRetardsData } from '../data/mockData';
import { formatKMF, getCompensationLabel, getCompensationColor } from '../utils/formatters';

interface LevelConfig {
  key: keyof typeof mockRetardsData.par_niveau;
  icon: React.ReactNode;
  name: string;
  threshold: string;
  badgeClass: string;
  bgClass: string;
}

const levels: LevelConfig[] = [
  {
    key: 'contact_preventif',
    icon: <Phone size={24} />,
    name: 'Contact préventif',
    threshold: '28j+',
    badgeClass: 'badge-info',
    bgClass: 'card bg-base-200',
  },
  {
    key: 'avoir_5pct',
    icon: <Shield size={24} />,
    name: 'Avoir 5%',
    threshold: '35j+',
    badgeClass: 'badge-warning',
    bgClass: 'card bg-base-200',
  },
  {
    key: 'remise_10pct_prochaine_cmd',
    icon: <AlertTriangle size={24} />,
    name: 'Remise −10%',
    threshold: '42j+',
    badgeClass: 'badge-error',
    bgClass: 'card bg-base-200',
  },
  {
    key: 'remboursement_possible',
    icon: <Clock size={24} />,
    name: 'Remboursement',
    threshold: '56j+',
    badgeClass: 'badge-error',
    bgClass: 'card bg-error/10',
  },
];

function getDelayBadgeClass(jours: number): string {
  if (jours >= 56) return 'badge-error';
  if (jours >= 42) return 'badge-error';
  if (jours >= 35) return 'badge-warning';
  if (jours >= 28) return 'badge-info';
  return 'badge-ghost';
}

export const RetardsView: React.FC = () => {
  const data = mockRetardsData;
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* TOP: Big total counter */}
      <div className="flex items-center justify-center gap-3 py-4">
        <AlertTriangle size={32} className="text-error" />
        <div className="text-center">
          <div className="text-4xl font-bold text-error">{data.total}</div>
          <div className="text-base-content/60 text-sm">commandes en retard</div>
        </div>
      </div>

      {/* ROW 1: 4 compensation level cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {levels.map((level) => {
          const info = data.par_niveau[level.key];
          return (
            <div key={level.key} className={level.bgClass}>
              <div className="card-body p-4 items-center text-center">
                <div className="opacity-60 mb-1">{level.icon}</div>
                <div className="text-3xl font-bold">{info.count}</div>
                <div className="font-semibold text-sm">{level.name}</div>
                <span className={`badge ${level.badgeClass} badge-sm mt-1`}>{level.threshold}</span>
                <div className="text-xs text-base-content/60 mt-1">{info.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ROW 2: Client action list */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-bold text-lg flex items-center gap-2 mb-3">
            <MessageSquare size={20} className="opacity-60" />
            Clients à traiter
          </h3>
          <div className="overflow-x-auto">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Client</th>
                  <th className="text-center">Jours retard</th>
                  <th>Compensation</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.clients.map((client) => (
                  <React.Fragment key={client.reference}>
                    <tr>
                      <td className="font-mono font-bold">{client.reference}</td>
                      <td>
                        <div className="font-semibold">{client.client_nom}</div>
                        <div className="text-xs text-base-content/60">{client.client_phone}</div>
                      </td>
                      <td className="text-center">
                        <span className={`badge ${getDelayBadgeClass(client.jours_retard)} font-bold`}>
                          {client.jours_retard}j
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${getCompensationColor(client.compensation)} badge-sm`}>
                          {getCompensationLabel(client.compensation)}
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-1 flex-wrap">
                          <button
                            className={`btn btn-info btn-sm ${expandedRow === client.reference ? 'btn-active' : ''}`}
                            onClick={() =>
                              setExpandedRow(expandedRow === client.reference ? null : client.reference)
                            }
                          >
                            📱 SMS
                          </button>
                          <button className="btn btn-primary btn-sm">
                            📧 Email
                          </button>
                          <button className="btn btn-success btn-sm">
                            ✅ Traité
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedRow === client.reference && (
                      <tr>
                        <td colSpan={5}>
                          <div className="bg-base-300 rounded-lg p-3 text-sm">
                            <div className="text-xs font-bold text-base-content/60 mb-1">SMS suggéré :</div>
                            <div>{client.sms_suggere}</div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* SLA Thresholds info card */}
      <div className="card bg-base-200">
        <div className="card-body p-3">
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <Shield size={16} className="opacity-60" />
            <span className="font-semibold">Seuils SLA :</span>
            <span>Préventif 28j → Avoir 35j → Remise 42j → Remboursement 56j</span>
          </div>
        </div>
      </div>
    </div>
  );
};
