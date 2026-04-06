import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Package, DollarSign, Target, AlertTriangle } from 'lucide-react';
import { TabId } from './types';
import { mockOpsData, mockFinanceData, mockPilotageData, mockAlerts } from './data/mockData';
import { OpsView } from './components/OpsView';
import { FinanceView } from './components/FinanceView';
import { PilotageView } from './components/PilotageView';
import { AlertsView } from './components/AlertsView';

const tabs: { id: TabId; label: string; icon: React.ReactNode; emoji: string }[] = [
  { id: 'ops', label: 'OPS', icon: <Package size={16} />, emoji: '📦' },
  { id: 'finance', label: 'Finance', icon: <DollarSign size={16} />, emoji: '💰' },
  { id: 'pilotage', label: 'Pilotage', icon: <Target size={16} />, emoji: '🎯' },
  { id: 'alerts', label: 'Alertes', icon: <AlertTriangle size={16} />, emoji: '🚨' },
];

const App: React.FC<{}> = () => {
  const [activeTab, setActiveTab] = useState<TabId>('ops');

  return (
    <div className="min-h-screen bg-base-100 p-4">
      {/* Tab Navigation */}
      <div className="tabs tabs-boxed bg-base-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab gap-2 ${activeTab === tab.id ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.emoji}</span>
            {tab.id === 'alerts' && mockAlerts.length > 0 && (
              <span className="badge badge-error badge-xs">{mockAlerts.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Active View */}
      {activeTab === 'ops' && <OpsView data={mockOpsData} />}
      {activeTab === 'finance' && <FinanceView data={mockFinanceData} />}
      {activeTab === 'pilotage' && <PilotageView data={mockPilotageData} />}
      {activeTab === 'alerts' && <AlertsView alerts={mockAlerts} />}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
