// Komerce Dashboard — API Service
// Typed fetch functions for the 10 dashboard endpoints

import type {
  OpsData,
  FinanceData,
  PilotageData,
  PipelineData,
  RetardsData,
  ForecastData,
  ClientsData,
  HistoryData,
  HubData,
  RelaisOrderData,
} from '../types';

// ── Configuration ───────────────────────────────────────────────────
// Default: relative URL (works when served from the same server)
// Override via setApiBase() for external access (e.g., Tasklet instant app)
let API_BASE = '/api/dashboard';

export function setApiBase(url: string): void {
  API_BASE = url.replace(/\/$/, '');
}

export function getApiBase(): string {
  return API_BASE;
}

// ── Generic fetch ───────────────────────────────────────────────────

async function fetchApi<T>(endpoint: string): Promise<T> {
  const url = `${API_BASE}/${endpoint}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

// ── Helper: end of current month ────────────────────────────────────

function endOfMonth(): string {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return end.toISOString().split('T')[0];
}

// ── Typed API functions ─────────────────────────────────────────────

export const api = {
  ops:           () => fetchApi<OpsData>('ops'),
  finance:       () => fetchApi<FinanceData>('finance'),
  pilotage:      () => fetchApi<PilotageData>('pilotage'),
  pipeline:      () => fetchApi<PipelineData>('pipeline'),
  retards:       () => fetchApi<RetardsData>('retards'),
  forecast:      () => fetchApi<ForecastData>(`forecast?target_date=${endOfMonth()}`),
  clients:       () => fetchApi<ClientsData>('clients'),
  history:       () => fetchApi<HistoryData>('history'),
  hubDubai:      () => fetchApi<HubData>('hub-dubai'),
  relaisOrders:  () => fetchApi<RelaisOrderData>('relais'),
};
