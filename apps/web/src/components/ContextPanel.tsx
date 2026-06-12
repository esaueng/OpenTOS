import type { ReactNode } from "react";

import {
  WORKFLOW_STEPS,
  canNavigateToStep,
  nextStep,
  previousStep,
  type StepId,
  type WorkflowSnapshot
} from "../lib/workflow";

interface ContextPanelProps {
  activeStep: StepId;
  snapshot: WorkflowSnapshot;
  onStepSelect: (step: StepId) => void;
  /** The active step's WorkflowPanel, rendered by the workspace container. */
  children: ReactNode;
}

function stepLabel(step: StepId | null): string | null {
  return WORKFLOW_STEPS.find((candidate) => candidate.id === step)?.label ?? null;
}

export function ContextPanel({ activeStep, snapshot, onStepSelect, children }: ContextPanelProps) {
  const previous = previousStep(activeStep);
  const next = nextStep(activeStep);
  const canGoNext = Boolean(next && canNavigateToStep(next, snapshot));

  return (
    <aside className="side-panel">
      {children}
      <div className="workflow-nav" aria-label="Workflow navigation">
        <button
          type="button"
          className="secondary"
          disabled={!previous}
          title="Previous workflow step (B)"
          onClick={() => previous && onStepSelect(previous)}
        >
          <span className="workflow-nav-label">{previous ? `Back: ${stepLabel(previous)}` : "Back"}</span>
          <kbd>B</kbd>
        </button>
        <button
          type="button"
          className="primary"
          disabled={!canGoNext}
          title="Next workflow step (N)"
          onClick={() => next && canGoNext && onStepSelect(next)}
        >
          <span className="workflow-nav-label">{next ? `Next: ${stepLabel(next)}` : "Next"}</span>
          <kbd>N</kbd>
        </button>
      </div>
    </aside>
  );
}
