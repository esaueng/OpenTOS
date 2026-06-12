import type { FaceRegion } from "@contracts/index";

import type { RegionLabel } from "../../types";
import { WorkflowPanel } from "../WorkflowPanel";

type ConstraintTool = Extract<RegionLabel, "fixed" | "obstacle" | "design">;

interface ConstraintsPanelProps {
  tool: ConstraintTool | null;
  onToolChange: (tool: ConstraintTool) => void;
  brushRadius: number;
  onBrushRadiusChange: (radius: number) => void;
  fixedCount: number;
  obstacleCount: number;
  fixedRegions: FaceRegion[];
}

const TOOL_HELP: Record<ConstraintTool, string> = {
  fixed: "Click a surface to mark it fixed. Fixed interfaces anchor the part and are referenced by load cases as boundary conditions.",
  obstacle: "Drag to paint keep-out faces. The generator will not place material near obstacle regions.",
  design: "Drag to erase painted faces back to design space."
};

export function ConstraintsPanel({
  tool,
  onToolChange,
  brushRadius,
  onBrushRadiusChange,
  fixedCount,
  obstacleCount,
  fixedRegions
}: ConstraintsPanelProps) {
  return (
    <WorkflowPanel
      step="constraints"
      helper="Anchor the part with fixed interfaces and fence off keep-out zones. At least one fixed surface is required to run."
    >
      <div className="segmented" role="group" aria-label="Constraint tool">
        <button type="button" className={tool === "fixed" ? "active" : ""} onClick={() => onToolChange("fixed")}>
          Fixed
        </button>
        <button type="button" className={tool === "obstacle" ? "active" : ""} onClick={() => onToolChange("obstacle")}>
          Obstacle
        </button>
        <button type="button" className={tool === "design" ? "active" : ""} onClick={() => onToolChange("design")}>
          Erase
        </button>
      </div>
      <p className="panel-copy">{tool ? TOOL_HELP[tool] : "Pick a tool to edit constraint regions."}</p>

      {(tool === "obstacle" || tool === "design") && (
        <label className="field">
          Brush radius
          <input
            type="range"
            min={0.02}
            max={0.2}
            step={0.01}
            value={brushRadius}
            onChange={(event) => onBrushRadiusChange(Number(event.target.value))}
          />
          <small className="field-hint">Relative to the part size.</small>
        </label>
      )}

      <div className="info-rows">
        <div className="info-row"><span>fixed faces</span><strong className="mono">{fixedCount.toLocaleString()}</strong></div>
        <div className="info-row"><span>obstacle faces</span><strong className="mono">{obstacleCount.toLocaleString()}</strong></div>
      </div>

      {fixedRegions.length > 0 ? (
        <div className="region-list" aria-label="Fixed regions">
          {fixedRegions.map((region) => (
            <span key={region.id} className="region-chip fixed">
              <i aria-hidden="true" />
              <span className="mono">{region.id}</span>
              <b>{region.faceIndices.length}</b>
            </span>
          ))}
        </div>
      ) : (
        <p className="panel-copy empty-copy">No fixed interfaces yet. Mark the surfaces that bolt or clamp to the rest of the assembly.</p>
      )}
    </WorkflowPanel>
  );
}
