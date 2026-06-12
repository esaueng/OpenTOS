import type { ReactNode } from "react";

import { WORKFLOW_STEPS, type StepId } from "../lib/workflow";

/** Shared right-panel section chrome: title, step eyebrow, helper copy. */
export function WorkflowPanel({ step, helper, children }: { step: StepId; helper: string; children: ReactNode }) {
  const index = WORKFLOW_STEPS.findIndex((candidate) => candidate.id === step);
  const label = index >= 0 ? WORKFLOW_STEPS[index].label : step;

  return (
    <div className="panel-section">
      <div className="panel-header">
        <div className="panel-title-row">
          <h2>{label}</h2>
          <div className="panel-eyebrow">Step {Math.max(index, 0) + 1} of {WORKFLOW_STEPS.length}</div>
        </div>
        <p className="helper">{helper}</p>
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
}
