// Komerce Dashboard — LoadingError component
// Shows a loading spinner or error banner with optional mock-data badge

import React from 'react';
import { RefreshCw, AlertTriangle, Database } from 'lucide-react';

interface LoadingErrorProps {
  loading: boolean;
  error: string | null;
  usingMock: boolean;
  reload: () => void;
  /** Optionally hide the mock badge in views that always use mock data */
  hideMockBadge?: boolean;
}

export const LoadingError: React.FC<LoadingErrorProps> = ({
  loading,
  error,
  usingMock,
  reload,
  hideMockBadge,
}) => {
  return (
    <>
      {/* Loading overlay */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <span className="loading loading-spinner loading-lg text-primary" />
          <span className="ml-3 text-base-content/60">Chargement…</span>
        </div>
      )}

      {/* Error banner */}
      {!loading && error && (
        <div className="alert alert-warning mb-4">
          <AlertTriangle size={18} />
          <div className="flex-1">
            <div className="font-bold text-sm">API indisponible</div>
            <div className="text-xs">{error}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={reload}>
            <RefreshCw size={14} />
            Réessayer
          </button>
        </div>
      )}

      {/* Mock data badge */}
      {!loading && usingMock && !hideMockBadge && (
        <div className="flex items-center gap-1.5 mb-3">
          <span className="badge badge-warning badge-sm gap-1">
            <Database size={12} />
            Données de démonstration
          </span>
        </div>
      )}
    </>
  );
};
