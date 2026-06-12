import { Grid3x3, Layers, Maximize, Eye } from "lucide-react";

interface ViewerToolbarProps {
  showOriginal: boolean;
  showOutcomeOverlay: boolean;
  wireframe: boolean;
  hasOutcome: boolean;
  onToggleOriginal: () => void;
  onToggleOutcomeOverlay: () => void;
  onToggleWireframe: () => void;
  onFit: () => void;
}

export function ViewerToolbar({
  showOriginal,
  showOutcomeOverlay,
  wireframe,
  hasOutcome,
  onToggleOriginal,
  onToggleOutcomeOverlay,
  onToggleWireframe,
  onFit
}: ViewerToolbarProps) {
  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="Viewer display options">
      <button
        type="button"
        className={showOriginal ? "active" : ""}
        onClick={onToggleOriginal}
        title="Toggle original part"
        aria-pressed={showOriginal}
      >
        <Eye size={14} aria-hidden="true" />
        Original
      </button>
      <button
        type="button"
        className={showOutcomeOverlay ? "active" : ""}
        disabled={!hasOutcome}
        onClick={onToggleOutcomeOverlay}
        title={hasOutcome ? "Toggle generated outcome" : "Run a study to view generated outcomes"}
        aria-pressed={showOutcomeOverlay}
      >
        <Layers size={14} aria-hidden="true" />
        Generated
      </button>
      <button
        type="button"
        className={wireframe ? "active" : ""}
        disabled={!hasOutcome}
        onClick={onToggleWireframe}
        title="Toggle wireframe on the generated outcome"
        aria-pressed={wireframe}
      >
        <Grid3x3 size={14} aria-hidden="true" />
        Wireframe
      </button>
      <span className="viewer-toolbar-divider" aria-hidden="true" />
      <button type="button" onClick={onFit} title="Fit view to part">
        <Maximize size={14} aria-hidden="true" />
        Fit
      </button>
    </div>
  );
}
