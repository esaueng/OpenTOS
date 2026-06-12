import { useMemo } from "react";
import type { OutcomeV2 } from "@contracts/index";

import type { JobStatus } from "../types";
import { OutcomeCard } from "./OutcomeCard";
import { stageLabel } from "./panels/GeneratePanel";

interface OutcomePanelProps {
  outcomes: OutcomeV2[];
  selectedOutcomeId: string | null;
  jobStatus: JobStatus | null;
  onSelectOutcome: (outcomeId: string) => void;
}

export function OutcomePanel({ outcomes, selectedOutcomeId, jobStatus, onSelectOutcome }: OutcomePanelProps) {
  const ranked = useMemo(
    () =>
      [...outcomes].sort((a, b) => {
        const aScore = typeof a.variantParams?.rankScore === "number" ? Number(a.variantParams.rankScore) : Number.POSITIVE_INFINITY;
        const bScore = typeof b.variantParams?.rankScore === "number" ? Number(b.variantParams.rankScore) : Number.POSITIVE_INFINITY;
        if (aScore !== bScore) {
          return aScore - bScore;
        }
        return a.id.localeCompare(b.id);
      }),
    [outcomes]
  );
  const running = jobStatus?.status === "running" || jobStatus?.status === "queued";

  return (
    <section className="outcome-panel" aria-label="Generated outcomes">
      <div className="outcome-panel-head">
        <span className="panel-eyebrow">outcomes</span>
        <span className="count-pill mono">{outcomes.length}</span>
        {running && jobStatus && (
          <span className="outcome-run-strip mono">
            {stageLabel(jobStatus.stage)} · {Math.round(jobStatus.progress * 100)}%
            <i className="outcome-run-bar" aria-hidden="true">
              <i style={{ width: `${Math.round(jobStatus.progress * 100)}%` }} />
            </i>
          </span>
        )}
      </div>
      {ranked.length > 0 ? (
        <div className="outcome-strip" role="list">
          {ranked.map((outcome, index) => (
            <OutcomeCard
              key={outcome.id}
              outcome={outcome}
              rank={index + 1}
              selected={selectedOutcomeId === outcome.id}
              onSelect={onSelectOutcome}
            />
          ))}
        </div>
      ) : (
        <div className="outcome-empty mono">{running ? "Synthesizing variants…" : "Outcomes appear here after a run."}</div>
      )}
    </section>
  );
}
