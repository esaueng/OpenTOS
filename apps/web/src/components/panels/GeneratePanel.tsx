import { Play } from "lucide-react";

import type { ChecklistItem } from "../../lib/workflow";
import type { JobStatus } from "../../types";
import { ValidationChecklist } from "../ValidationChecklist";
import { WorkflowPanel } from "../WorkflowPanel";

const STAGES: JobStatus["stage"][] = [
  "queued",
  "parse",
  "constraint-map",
  "voxelize",
  "fem-solve",
  "topology-opt",
  "reconstruct",
  "rank-export",
  "complete"
];

export function stageLabel(stage: JobStatus["stage"]): string {
  switch (stage) {
    case "constraint-map":
      return "Constraint map";
    case "fem-solve":
      return "FE proxy solve";
    case "topology-opt":
      return "Topology optimization";
    case "rank-export":
      return "Rank & export";
    default:
      return stage.replace("-", " ");
  }
}

interface GeneratePanelProps {
  checklist: ChecklistItem[];
  canRun: boolean;
  running: boolean;
  jobStatus: JobStatus | null;
  warnings: string[];
  onRun: () => void;
}

export function GeneratePanel({ checklist, canRun, running, jobStatus, warnings, onRun }: GeneratePanelProps) {
  const stageIndex = jobStatus ? STAGES.indexOf(jobStatus.stage === "failed" ? "complete" : jobStatus.stage) : -1;

  return (
    <WorkflowPanel
      step="generate"
      helper="Run the study once setup is complete. The solver synthesizes load-path-driven variants and ranks them against your targets."
    >
      <span className="section-title">Setup checklist</span>
      <ValidationChecklist items={checklist} />

      <button type="button" className="primary wide run-button" disabled={!canRun} onClick={onRun}>
        <Play size={15} aria-hidden="true" />
        {running ? "Generating…" : "Run generative study"}
      </button>

      {jobStatus && (
        <div className="run-status" aria-live="polite">
          <div className="progress">
            <span style={{ width: `${Math.round(jobStatus.progress * 100)}%` }} />
            <div className="progress-label">
              {stageLabel(jobStatus.stage)} · {Math.round(jobStatus.progress * 100)}%
            </div>
          </div>
          <div className="stage-track" aria-label="Solver stages">
            {STAGES.map((stage, index) => (
              <span key={stage} className={`stage-dot ${index <= Math.max(0, stageIndex) ? "hit" : ""} ${jobStatus.stage === stage ? "current" : ""}`}>
                {stageLabel(stage)}
              </span>
            ))}
          </div>
          <div className="info-rows">
            {jobStatus.qualityProfile && (
              <div className="info-row"><span>quality</span><strong className="mono">{jobStatus.qualityProfile}</strong></div>
            )}
            {jobStatus.etaSeconds != null && jobStatus.status === "running" && (
              <div className="info-row"><span>eta</span><strong className="mono">~{Math.max(0, jobStatus.etaSeconds)}s</strong></div>
            )}
            <div className="info-row"><span>solver</span><strong className="mono">{jobStatus.solverVersion}</strong></div>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="panel-warning" role="status">
          {warnings.map((warning, idx) => (
            <p key={`${idx}-${warning}`}>{warning}</p>
          ))}
        </div>
      )}
    </WorkflowPanel>
  );
}
