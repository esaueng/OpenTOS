import { Shield } from "lucide-react";
import type { FaceRegion } from "@contracts/index";

import { WorkflowPanel } from "../WorkflowPanel";

interface PreservePanelProps {
  selecting: boolean;
  onToggleSelecting: () => void;
  preservedCount: number;
  preservedRegions: FaceRegion[];
}

export function PreservePanel({ selecting, onToggleSelecting, preservedCount, preservedRegions }: PreservePanelProps) {
  return (
    <WorkflowPanel
      step="preserve"
      helper="Mark interfaces the generator must keep untouched — bores, bosses, and mating faces. Preserved geometry is exported unmodified."
    >
      <button
        type="button"
        className={`tool-button wide ${selecting ? "active" : ""}`}
        onClick={onToggleSelecting}
        aria-pressed={selecting}
      >
        <Shield size={15} aria-hidden="true" />
        {selecting ? "Selecting — click a surface" : "Select preserved surface"}
      </button>
      <p className="panel-copy">
        One click selects a contiguous interface (a full bore wall, for example). Right-click a preserved surface to
        clear it back to design space.
      </p>

      <div className="info-rows">
        <div className="info-row"><span>preserved faces</span><strong className="mono">{preservedCount.toLocaleString()}</strong></div>
        <div className="info-row"><span>regions</span><strong className="mono">{preservedRegions.length}</strong></div>
      </div>

      {preservedRegions.length > 0 ? (
        <div className="region-list" aria-label="Preserved regions">
          {preservedRegions.map((region) => (
            <span key={region.id} className="region-chip preserved">
              <i aria-hidden="true" />
              <span className="mono">{region.id}</span>
              <b>{region.faceIndices.length}</b>
            </span>
          ))}
        </div>
      ) : (
        <p className="panel-copy empty-copy">No preserved regions yet. Recommended: keep every surface another part touches.</p>
      )}
    </WorkflowPanel>
  );
}
