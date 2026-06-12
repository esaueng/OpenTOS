import { Anchor, Box, ChartColumn, Play, Shield, SlidersHorizontal, Weight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { WORKFLOW_STEPS, type StepId, type WorkflowSnapshot, canNavigateToStep, stepCompletion } from "../lib/workflow";

const STEP_ICONS: Record<StepId, LucideIcon> = {
  model: Box,
  preserve: Shield,
  constraints: Anchor,
  loads: Weight,
  study: SlidersHorizontal,
  generate: Play,
  results: ChartColumn
};

interface StepBarProps {
  activeStep: StepId;
  snapshot: WorkflowSnapshot;
  solverMode: "browser" | "api";
  units: string;
  onSelect: (step: StepId) => void;
}

export function StepBar({ activeStep, snapshot, solverMode, units, onSelect }: StepBarProps) {
  const completed = stepCompletion(snapshot);

  return (
    <nav className="stepbar" aria-label="Generative design workflow">
      <div className="stepbar-header">
        <div className="stepbar-eyebrow">workflow</div>
      </div>
      <div className="step-list">
        {WORKFLOW_STEPS.map((step) => {
          const isActive = activeStep === step.id;
          const isComplete = completed[step.id];
          const canSelect = canNavigateToStep(step.id, snapshot);
          const StepIcon = STEP_ICONS[step.id];
          const isRunning = step.id === "generate" && snapshot.running;
          return (
            <button
              key={step.id}
              type="button"
              className={`step ${isActive ? "active" : ""}`}
              disabled={!canSelect}
              onClick={() => onSelect(step.id)}
              aria-current={isActive ? "step" : undefined}
            >
              <span className={`step-icon ${isComplete ? "done" : ""} ${isRunning ? "running" : ""}`} aria-hidden="true">
                <StepIcon size={18} strokeWidth={1.8} />
              </span>
              <span>{step.label}</span>
            </button>
          );
        })}
      </div>
      <div className="stepbar-footer">
        <div><span>solver</span><strong>{solverMode}</strong></div>
        <div><span>units</span><strong>{units}</strong></div>
        <div><span>outcomes</span><strong>{snapshot.outcomeCount}</strong></div>
      </div>
    </nav>
  );
}
