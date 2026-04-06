import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LayoutDashboard, Kanban, Building2, MapPin, DollarSign, Users, ShoppingBag, AlertTriangle, TrendingUp } from 'lucide-react';
import { OverviewView } from './components/OverviewView';
import { PipelineView } from './components/PipelineView';
import { HubDubaiView } from './components/HubDubaiView';
import { RelaisView } from './components/RelaisView';
import { FinanceView } from './components/FinanceView';
import { ClientsView } from './components/ClientsView';
import { CatalogueView } from './components/CatalogueView';
import { RetardsView } from './components/RetardsView';
import { TendancesView } from './components/TendancesView';

type TabId = 'overview' | 'pipeline' | 'hub' | 'relais' | 'finance' | 'clients' | 'catalogue' | 'retards' | 'tendances';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const tabs: Tab[] = [
  { id: 'overview', label: 'Vue d\'ensemble', icon: <LayoutDashboard size={16} /> },
  { id: 'pipeline', label: 'Pipeline', icon: <Kanban size={16} /> },
  { id: 'hub', label: 'Hub Dubai', icon: <Building2 size={16} /> },
  { id: 'relais', label: 'Relais', icon: <MapPin size={16} /> },
  { id: 'finance', label: 'Finance', icon: <DollarSign size={16} /> },
  { id: 'clients', label: 'Clients', icon: <Users size={16} /> },
  { id: 'catalogue', label: 'Catalogue', icon: <ShoppingBag size={16} /> },
  { id: 'retards', label: 'Retards & SAV', icon: <AlertTriangle size={16} /> },
  { id: 'tendances', label: 'Tendances', icon: <TrendingUp size={16} /> },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const renderView = () => {
    switch (activeTab) {
      case 'overview': return <OverviewView />;
      case 'pipeline': return <PipelineView />;
      case 'hub': return <HubDubaiView />;
      case 'relais': return <RelaisView />;
      case 'finance': return <FinanceView />;
      case 'clients': return <ClientsView />;
      case 'catalogue': return <CatalogueView />;
      case 'retards': return <RetardsView />;
      case 'tendances': return <TendancesView />;
      default: return <OverviewView />;
    }
  };

  return (
    <div className="min-h-screen bg-base-100 flex flex-col">
      {/* Tab navigation */}
      <div className="sticky top-0 z-50 bg-base-100 border-b border-base-300">
        <div className="overflow-x-auto">
          <div role="tablist" className="tabs tabs-bordered flex-nowrap px-2 pt-1">
            {tabs.map((tab) => (
              <a
                key={tab.id}
                role="tab"
                className={`tab gap-1 whitespace-nowrap text-sm ${activeTab === tab.id ? 'tab-active font-semibold' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                {tab.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* View content */}
      <div className="flex-1 p-4 overflow-y-auto">
        {renderView()}
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
