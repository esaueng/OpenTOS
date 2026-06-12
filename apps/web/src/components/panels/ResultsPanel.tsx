import type { OutcomeV2 } from "@contracts/index";

import { WorkflowPanel } from "../WorkflowPanel";

interface ResultsPanelProps {
  outcomes: OutcomeV2[];
  selectedOutcome: OutcomeV2 | null;
}

function formatMetric(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }
  return value.toFixed(3);
}

export function ResultsPanel({ outcomes, selectedOutcome }: ResultsPanelProps) {
  const rank = selectedOutcome ? outcomes.findIndex((outcome) => outcome.id === selectedOutcome.id) + 1 : 0;

  return (
    <WorkflowPanel
      step="results"
      helper="Compare generated variants in the outcome strip below. Use the viewer toolbar to overlay the original part or inspect wireframe."
    >
      {outcomes.length === 0 ? (
        <p className="panel-copy empty-copy">No outcomes yet. Run a generative study to populate results.</p>
      ) : selectedOutcome ? (
        <>
          <div className="subsection-head">
            <span className="section-title">Selected outcome</span>
            <span className="rank-pill mono">{selectedOutcome.id} · rank {rank}/{outcomes.length}</span>
          </div>
          <div className="info-rows">
            <div className="info-row"><span>volume</span><strong className="mono">{formatMetric(selectedOutcome.metrics.volume)}</strong></div>
            <div className="info-row"><span>mass est.</span><strong className="mono">{formatMetric(selectedOutcome.metrics.mass)} kg</strong></div>
            <div className="info-row"><span>mass reduction</span><strong className="mono">{formatMetric(selectedOutcome.metrics.massReductionPct)}%</strong></div>
            <div className="info-row"><span>stress proxy</span><strong className="mono">{formatMetric(selectedOutcome.metrics.stressProxy)} MPa</strong></div>
            <div className="info-row"><span>displacement proxy</span><strong className="mono">{formatMetric(selectedOutcome.metrics.displacementProxy)} mm</strong></div>
            <div className="info-row"><span>safety proxy</span><strong className="mono">{formatMetric(selectedOutcome.metrics.safetyIndexProxy)}</strong></div>
          </div>
          <p className="panel-copy">
            Proxy metrics are deterministic and comparable across outcomes of the same study; they are not certified
            engineering values.
          </p>
        </>
      ) : (
        <p className="panel-copy empty-copy">Select an outcome card below to inspect its metrics.</p>
      )}
    </WorkflowPanel>
  );
}
