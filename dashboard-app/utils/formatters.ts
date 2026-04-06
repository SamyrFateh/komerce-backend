export function formatKMF(n: number): string {
  return n.toLocaleString('fr-FR') + ' KMF';
}

export function formatEUR(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
}

export function formatPct(n: number, showSign = true): string {
  const sign = showSign && n > 0 ? '+' : '';
  return sign + n.toFixed(1) + '%';
}

export function formatDays(n: number): string {
  return n.toFixed(1) + 'j';
}

export function formatDate(d: string): string {
  const date = new Date(d);
  return date.toLocaleDateString('fr-FR');
}

export function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'badge-error';
    case 'warning': return 'badge-warning';
    case 'info': return 'badge-info';
    default: return 'badge-ghost';
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case 'confirmed': return 'bg-info/20 text-info';
    case 'ordered': return 'bg-warning/20 text-warning';
    case 'preparation': return 'bg-secondary/20 text-secondary';
    case 'shipped': return 'bg-primary/20 text-primary';
    case 'in_transit': return 'bg-accent/20 text-accent';
    case 'available': return 'bg-success/20 text-success';
    case 'collected': return 'bg-success/20 text-success';
    case 'cancelled': return 'bg-error/20 text-error';
    default: return 'bg-base-300 text-base-content';
  }
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    confirmed: 'Confirmée',
    ordered: 'Commandée',
    preparation: 'Préparation',
    shipped: 'Expédiée',
    in_transit: 'En transit',
    available: 'Disponible',
    collected: 'Collectée',
    cancelled: 'Annulée',
  };
  return labels[status] || status;
}
