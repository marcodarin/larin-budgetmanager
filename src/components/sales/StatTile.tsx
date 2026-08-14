interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
}

/** Riquadro statistico compatto, stesso stile di InvoiceQueue (.stat-card). */
export const StatTile = ({ label, value, hint }: StatTileProps) => (
  <div className="stat-card">
    <div className="stat-value break-words">{value}</div>
    <div className="stat-label">{label}</div>
    {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
  </div>
);
