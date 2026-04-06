// Komerce Dashboard — Shared formatters

/**
 * Format a KMF amount with space-separated thousands.
 * e.g. 2850000 → "2 850 000 KMF"
 */
export function formatKMF(amount: number): string {
  const formatted = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} KMF`;
}

/**
 * Format a EUR amount with space-separated thousands.
 * e.g. 5793 → "5 793 €"
 */
export function formatEUR(amount: number): string {
  const formatted = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} €`;
}

/**
 * Format a percentage with sign prefix.
 * e.g. 15.2 → "+15.2%", -3.5 → "-3.5%"
 */
export function formatPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

/**
 * Format an ISO date string as DD/MM/YYYY.
 * e.g. "2026-04-01" → "01/04/2026"
 */
export function formatDate(dateStr: string): string {
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length < 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * French label for an order status.
 */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    confirmed: 'Confirmée',
    ordered: 'Commandée',
    preparation: 'En préparation',
    shipped: 'Expédiée',
    in_transit: 'En transit',
    available: 'Disponible',
    collected: 'Collectée',
    cancelled: 'Annulée',
    refunded: 'Remboursée',
  };
  return labels[status] || status;
}

/**
 * DaisyUI badge class for an order status.
 */
export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    confirmed: 'badge-info',
    ordered: 'badge-info',
    preparation: 'badge-warning',
    shipped: 'badge-primary',
    in_transit: 'badge-primary',
    available: 'badge-success',
    collected: 'badge-success',
    cancelled: 'badge-error',
    refunded: 'badge-error',
  };
  return colors[status] || 'badge-ghost';
}

/**
 * French label for a compensation level.
 */
export function getCompensationLabel(compensation: string): string {
  const labels: Record<string, string> = {
    contact_preventif: 'Contact préventif',
    avoir_5pct: 'Avoir 5%',
    remise_10pct_prochaine_cmd: 'Remise −10%',
    remboursement_possible: 'Remboursement',
  };
  return labels[compensation] || compensation;
}

/**
 * DaisyUI badge class for a compensation level.
 */
export function getCompensationColor(compensation: string): string {
  const colors: Record<string, string> = {
    contact_preventif: 'badge-info',
    avoir_5pct: 'badge-warning',
    remise_10pct_prochaine_cmd: 'badge-error',
    remboursement_possible: 'badge-error',
  };
  return colors[compensation] || 'badge-ghost';
}
