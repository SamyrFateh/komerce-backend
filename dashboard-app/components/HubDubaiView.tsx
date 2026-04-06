import React, { useState, useMemo } from 'react';
import { Package, Truck, Building2, Ship, MapPin, CheckCircle, ArrowRight } from 'lucide-react';
import { mockOpsData } from '../data/mockData';
import { getStatusLabel, getStatusColor } from '../utils/formatters';
import type { LogistiqueStep, LogistiqueItem } from '../types';

const STEP_KEYS = ['dubai_reception', 'dubai_expedition', 'transitaire', 'bateau', 'anjouan'] as const;
type StepKey = typeof STEP_KEYS[number];

const STEP_CONFIG: Record<StepKey, { icon: React.ReactNode; label: string }> = {
  dubai_reception:  { icon: <Package size={32} />,   label: 'Réception Dubai' },
  dubai_expedition: { icon: <Truck size={32} />,     label: 'Expédition Dubai' },
  transitaire:      { icon: <Building2 size={32} />, label: 'Transitaire' },
  bateau:           { icon: <Ship size={32} />,      label: 'En mer' },
  anjouan:          { icon: <MapPin size={32} />,    label: 'Arrivée Anjouan' },
};

function getDaysColor(days: number): string {
  if (days < 7) return 'text-success';
  if (days < 14) return 'text-warning';
  return 'text-error';
}

export const HubDubaiView: React.FC = () => {
  const ops = mockOpsData;
  const logistique = ops.logistique;

  // Find first step with items
  const defaultStep = useMemo(() => {
    for (const key of STEP_KEYS) {
      if (logistique[key].count > 0) return key;
    }
    return 'dubai_reception' as StepKey;
  }, []);

  const [selectedStep, setSelectedStep] = useState<StepKey>(defaultStep);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const currentStep: LogistiqueStep = logistique[selectedStep];
  const config = STEP_CONFIG[selectedStep];

  const toggleItem = (ref: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(ref)) {
        next.delete(ref);
      } else {
        next.add(ref);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItems.size === currentStep.items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(currentStep.items.map(i => i.reference)));
    }
  };

  const handleStepClick = (key: StepKey) => {
    setSelectedStep(key);
    setSelectedItems(new Set());
  };

  // Total pipeline items
  const totalItems = STEP_KEYS.reduce((sum, key) => sum + logistique[key].count, 0);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* TOP ROW: 5 big step cards */}
      <div className="grid grid-cols-5 gap-4">
        {STEP_KEYS.map((key) => {
          const step = logistique[key];
          const stepCfg = STEP_CONFIG[key];
          const isSelected = selectedStep === key;
          return (
            <div
              key={key}
              className={`card bg-base-200 cursor-pointer transition-all hover:scale-[1.02] ${
                isSelected ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => handleStepClick(key)}
            >
              <div className="card-body p-4 items-center text-center">
                <div className="opacity-60">{stepCfg.icon}</div>
                <div className="text-4xl font-bold mt-2">{step.count}</div>
                <div className="text-sm text-base-content/60">{stepCfg.label}</div>
                {step.items.length > 0 && (
                  <div className="text-xs text-base-content/40 mt-1">
                    Moy: {Math.round(step.items.reduce((s, i) => s + i.jours, 0) / step.items.length)}j
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* MIDDLE: Selected step detail panel */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="opacity-60">{config.icon}</div>
              <div>
                <div className="text-xl font-bold">{config.label}</div>
                <div className="text-sm text-base-content/60">
                  {currentStep.count} colis dans cette étape
                </div>
              </div>
            </div>
            {currentStep.items.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-base-content/60">
                  {selectedItems.size} sélectionné(s)
                </span>
                <button
                  className="btn btn-primary btn-lg"
                  onClick={() => {
                    // Bulk validate action
                    setSelectedItems(new Set());
                  }}
                  disabled={selectedItems.size === 0}
                >
                  <CheckCircle size={20} />
                  Tout valider
                </button>
              </div>
            )}
          </div>

          {currentStep.items.length === 0 ? (
            <div className="text-center py-12 text-base-content/40">
              <Package size={48} className="mx-auto mb-3 opacity-30" />
              <div className="text-lg">Aucun colis à traiter</div>
              <div className="text-sm">
                {currentStep.count > 0
                  ? `${currentStep.count} colis dans cette étape (données détaillées non chargées)`
                  : 'Cette étape est vide'}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-zebra">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-primary"
                        checked={selectedItems.size === currentStep.items.length && currentStep.items.length > 0}
                        onChange={toggleAll}
                      />
                    </th>
                    <th>Référence</th>
                    <th>Statut</th>
                    <th>Jours</th>
                    <th>Destinataire</th>
                    <th>Relais</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentStep.items.map((item: LogistiqueItem) => (
                    <tr key={item.reference}>
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-primary"
                          checked={selectedItems.has(item.reference)}
                          onChange={() => toggleItem(item.reference)}
                        />
                      </td>
                      <td className="font-mono font-bold">{item.reference}</td>
                      <td>
                        <span className={`badge ${getStatusColor(item.status)} badge-sm`}>
                          {getStatusLabel(item.status)}
                        </span>
                      </td>
                      <td>
                        <span className={`font-bold ${getDaysColor(item.jours)}`}>
                          {item.jours}j
                        </span>
                      </td>
                      <td className="text-sm">{item.destinataire || '—'}</td>
                      <td className="text-sm">{item.relais_nom || '—'}</td>
                      <td>
                        <div className="flex gap-1">
                          <button className="btn btn-success btn-sm">
                            <CheckCircle size={14} /> Valider
                          </button>
                          <button className="btn btn-primary btn-sm">
                            <ArrowRight size={14} /> Suivant
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM: Stats bar */}
      <div className="flex gap-4">
        <div className="card bg-base-200 flex-1">
          <div className="card-body p-4 items-center">
            <div className="text-base-content/60 text-sm">Moy. préparation</div>
            <div className="text-3xl font-bold">{ops.delais.avg_preparation_jours}j</div>
          </div>
        </div>
        <div className="card bg-base-200 flex-1">
          <div className="card-body p-4 items-center">
            <div className="text-base-content/60 text-sm">Moy. livraison totale</div>
            <div className="text-3xl font-bold">{ops.delais.avg_livraison_totale_jours}j</div>
          </div>
        </div>
        <div className="card bg-base-200 flex-1">
          <div className="card-body p-4 items-center">
            <div className="text-base-content/60 text-sm">Total dans le pipeline</div>
            <div className="text-3xl font-bold">{totalItems}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
