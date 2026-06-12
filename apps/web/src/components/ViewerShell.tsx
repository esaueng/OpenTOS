import type { ReactNode } from "react";
import { Box } from "lucide-react";

import type { RegionLabel } from "../types";

interface ViewerShellProps {
  hasModel: boolean;
  paintLabel: RegionLabel | null;
  placeForceMode: boolean;
  toolbar: ReactNode;
  legend: ReactNode;
  children: ReactNode;
}

function activeModeHint(paintLabel: RegionLabel | null, placeForceMode: boolean): string | null {
  if (placeForceMode) {
    return "Click a model surface to place the force";
  }
  switch (paintLabel) {
    case "preserved":
      return "Left-click selects a preserved interface · right-click clears it";
    case "fixed":
      return "Left-click selects a fixed interface · right-click clears it";
    case "obstacle":
      return "Drag to paint obstacle (keep-out) faces";
    case "design":
      return "Drag to paint faces back to design space";
    default:
      return null;
  }
}

export function ViewerShell({ hasModel, paintLabel, placeForceMode, toolbar, legend, children }: ViewerShellProps) {
  const modeHint = hasModel ? activeModeHint(paintLabel, placeForceMode) : null;

  return (
    <section className="viewer-shell" aria-label="3D viewport">
      {hasModel ? (
        children
      ) : (
        <div className="viewer-empty">
          <div className="model-notice">
            <Box size={20} strokeWidth={1.6} aria-hidden="true" />
            <strong>No model loaded</strong>
            <span>Upload an STL, OBJ, or GLB part — or load the sample connecting rod — from the Model panel.</span>
          </div>
        </div>
      )}
      {hasModel && toolbar}
      {modeHint && <div className="viewer-mode-chip mono">{modeHint}</div>}
      {hasModel && legend}
    </section>
  );
}
