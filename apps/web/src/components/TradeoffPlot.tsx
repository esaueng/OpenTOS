import type { OutcomeV2 } from "@contracts/index";

const WIDTH = 520;
const HEIGHT = 240;
const MARGIN = { top: 24, right: 32, bottom: 46, left: 56 };

export interface PlotPoint {
  id: string;
  x: number;
  y: number;
  mass: number;
  safety: number;
}

function extent(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.1, 1);
    return [min - padding, max + padding];
  }
  const padding = (max - min) * 0.12;
  return [min - padding, max + padding];
}

export function projectOutcomes(outcomes: OutcomeV2[]): PlotPoint[] {
  if (outcomes.length === 0) return [];
  const [minMass, maxMass] = extent(outcomes.map((outcome) => outcome.metrics.mass));
  const [minSafety, maxSafety] = extent(outcomes.map((outcome) => outcome.metrics.safetyIndexProxy));
  const xScale = (value: number) =>
    MARGIN.left + ((value - minMass) / (maxMass - minMass)) * (WIDTH - MARGIN.left - MARGIN.right);
  const yScale = (value: number) =>
    HEIGHT - MARGIN.bottom - ((value - minSafety) / (maxSafety - minSafety)) * (HEIGHT - MARGIN.top - MARGIN.bottom);
  return outcomes.map((outcome) => ({
    id: outcome.id,
    x: xScale(outcome.metrics.mass),
    y: yScale(outcome.metrics.safetyIndexProxy),
    mass: outcome.metrics.mass,
    safety: outcome.metrics.safetyIndexProxy
  }));
}

interface TradeoffPlotProps {
  outcomes: OutcomeV2[];
  selectedOutcomeId: string | null;
  targetSafetyFactor: number;
  onSelect: (id: string) => void;
}

export function TradeoffPlot({ outcomes, selectedOutcomeId, targetSafetyFactor, onSelect }: TradeoffPlotProps) {
  const points = projectOutcomes(outcomes);
  if (points.length === 0) {
    return <div className="empty-chart">Run a study to compare mass and safety.</div>;
  }

  const masses = outcomes.map((outcome) => outcome.metrics.mass);
  const safeties = outcomes.map((outcome) => outcome.metrics.safetyIndexProxy);
  const massRange = extent(masses);
  const safetyRange = extent([...safeties, targetSafetyFactor]);
  const targetY =
    HEIGHT -
    MARGIN.bottom -
    ((targetSafetyFactor - safetyRange[0]) / (safetyRange[1] - safetyRange[0])) *
      (HEIGHT - MARGIN.top - MARGIN.bottom);

  return (
    <figure className="tradeoff-figure" aria-labelledby="tradeoff-title">
      <figcaption id="tradeoff-title">Mass vs. safety factor</figcaption>
      <svg role="img" aria-describedby="tradeoff-description" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <desc id="tradeoff-description">
          Outcome comparison. Lower mass is further left and higher safety factor is higher.
        </desc>
        <line className="plot-axis" x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
        <line className="plot-axis" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={HEIGHT - MARGIN.bottom} y2={HEIGHT - MARGIN.bottom} />
        {targetY >= MARGIN.top && targetY <= HEIGHT - MARGIN.bottom && (
          <>
            <line className="plot-target" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={targetY} y2={targetY} />
            <text className="plot-target-label" x={WIDTH - MARGIN.right} y={targetY - 6} textAnchor="end">
              target {targetSafetyFactor.toFixed(1)}
            </text>
          </>
        )}
        <text className="plot-label" x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 8} textAnchor="middle">
          Mass ({massRange[0].toFixed(1)}–{massRange[1].toFixed(1)})
        </text>
        <text className="plot-label" transform={`translate(15 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle">
          Safety factor
        </text>
        {points.map((point) => {
          const selected = point.id === selectedOutcomeId;
          return (
            <g key={point.id} className={selected ? "plot-point is-selected" : "plot-point"}>
              <circle cx={point.x} cy={point.y} r={selected ? 8 : 6} />
              <text x={point.x + 10} y={point.y - 8}>{point.id}</text>
              <circle
                className="plot-hit"
                cx={point.x}
                cy={point.y}
                r={18}
                role="button"
                tabIndex={0}
                aria-label={`${point.id}: mass ${point.mass.toFixed(2)}, safety factor ${point.safety.toFixed(2)}`}
                aria-pressed={selected}
                onClick={() => onSelect(point.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(point.id);
                  }
                }}
              />
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
