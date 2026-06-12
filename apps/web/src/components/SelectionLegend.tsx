interface SelectionLegendProps {
  preservedCount: number;
  fixedCount: number;
  obstacleCount: number;
  forceCount: number;
}

const REGION_SWATCHES = [
  { id: "preserved", label: "preserved", color: "var(--color-region-preserved)" },
  { id: "fixed", label: "fixed", color: "var(--color-region-fixed)" },
  { id: "obstacle", label: "obstacle", color: "var(--color-region-obstacle)" },
  { id: "design", label: "design", color: "var(--color-region-design)" }
] as const;

export function SelectionLegend({ preservedCount, fixedCount, obstacleCount, forceCount }: SelectionLegendProps) {
  const counts: Record<string, number | null> = {
    preserved: preservedCount,
    fixed: fixedCount,
    obstacle: obstacleCount,
    design: null
  };

  return (
    <div className="selection-legend" aria-label="Region legend">
      {REGION_SWATCHES.map((swatch) => (
        <span key={swatch.id} className="selection-legend-row">
          <i style={{ background: swatch.color }} aria-hidden="true" />
          {swatch.label}
          {counts[swatch.id] != null && <b>{counts[swatch.id]}</b>}
        </span>
      ))}
      <span className="selection-legend-row">
        <i className="force-swatch" aria-hidden="true" />
        forces
        <b>{forceCount}</b>
      </span>
    </div>
  );
}
