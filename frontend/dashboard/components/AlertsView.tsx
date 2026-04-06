import React from 'react';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { Alert } from '../types';
import { severityColor } from '../utils/formatters';

interface AlertsViewProps {
  alerts: Alert[];
}

const typeLabels: Record<string, string> = {
  marge_negative: '💸 Marge négative',
  commande_bloquee: '📦 Commande bloquée',
  anomalie_douane: '🛃 Anomalie douane',
  sourcing_bloque: '🔗 Sourcing bloqué',
  paiement_attente: '⏳ Paiement en attente',
};

const SeverityIcon: React.FC<{ severity: string }> = ({ severity }) => {
  switch (severity) {
    case 'critical': return <AlertTriangle size={16} className="text-error" />;
    case 'warning': return <AlertCircle size={16} className="text-warning" />;
    default: return <Info size={16} className="text-info" />;
  }
};

export const AlertsView: React.FC<AlertsViewProps> = ({ alerts }) => {
  const critical = alerts.filter(a => a.severity === 'critical');
  const warning = alerts.filter(a => a.severity === 'warning');
  const info = alerts.filter(a => a.severity === 'info');

  const renderGroup = (title: string, groupAlerts: Alert[], badgeClass: string) => {
    if (groupAlerts.length === 0) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`badge ${badgeClass}`}>{groupAlerts.length}</span>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        {groupAlerts.map((alert, i) => (
          <div key={i} className="card bg-base-200 shadow-sm">
            <div className="card-body p-3">
              <div className="flex items-start gap-3">
                <SeverityIcon severity={alert.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{alert.message}</span>
                    <span className={`badge badge-xs ${severityColor(alert.severity)}`}>
                      {typeLabels[alert.type] || alert.type}
                    </span>
                  </div>
                  {alert.reference && (
                    <div className="text-xs font-mono text-base-content/50 mt-0.5">{alert.reference}</div>
                  )}
                  {alert.details && (
                    <div className="text-xs text-base-content/60 mt-1">{alert.details}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-base-content/60">
        <AlertTriangle size={14} className="opacity-60" />
        {alerts.length} alerte{alerts.length > 1 ? 's' : ''} active{alerts.length > 1 ? 's' : ''}
      </div>

      {renderGroup('🔴 Critiques', critical, 'badge-error')}
      {renderGroup('🟠 Avertissements', warning, 'badge-warning')}
      {renderGroup('🔵 Informations', info, 'badge-info')}

      {alerts.length === 0 && (
        <div className="text-center py-12 text-base-content/40">
          <AlertTriangle size={48} className="mx-auto mb-3 opacity-40" />
          <div className="text-lg font-medium">Aucune alerte</div>
          <div className="text-sm">Tout est sous contrôle 🎉</div>
        </div>
      )}
    </div>
  );
};
