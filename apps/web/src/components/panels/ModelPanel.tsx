import { useRef } from "react";
import { FolderOpen, Upload } from "lucide-react";

import type { StudySettings, UploadedModel } from "../../types";
import { WorkflowPanel } from "../WorkflowPanel";

interface ModelPanelProps {
  model: UploadedModel | null;
  faceCount: number;
  units: StudySettings["units"];
  onUnitsChange: (units: StudySettings["units"]) => void;
  onUploadFile: (file: File) => void;
  onLoadSample: () => void;
}

export function ModelPanel({ model, faceCount, units, onUnitsChange, onUploadFile, onLoadSample }: ModelPanelProps) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <WorkflowPanel
      step="model"
      helper="Load the part to optimize. Orbit with left-drag, pan with right-drag, zoom with scroll."
    >
      <input
        ref={uploadInputRef}
        className="hidden-file-input"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept=".stl,.obj,.glb"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            onUploadFile(file);
          }
        }}
      />
      <div className="button-grid">
        <button type="button" className="primary" onClick={() => uploadInputRef.current?.click()}>
          <Upload size={15} aria-hidden="true" />
          Upload model
        </button>
        <button type="button" className="secondary" onClick={onLoadSample}>
          <FolderOpen size={15} aria-hidden="true" />
          Load sample
        </button>
      </div>
      <p className="panel-copy">STL, OBJ, and GLB are supported. The sample is a connecting rod sized in millimeters.</p>

      <label className="field">
        Model units
        <select value={units} onChange={(event) => onUnitsChange(event.target.value as StudySettings["units"])}>
          <option value="mm">millimeters (mm)</option>
          <option value="in">inches (in)</option>
          <option value="m">meters (m)</option>
        </select>
        <small className="field-hint">Coordinates in the file are interpreted in these units for mass and stress proxies.</small>
      </label>

      <div className="info-rows">
        <div className="info-row"><span>file</span><strong className="mono">{model?.fileName ?? "—"}</strong></div>
        <div className="info-row"><span>format</span><strong className="mono">{model ? model.format.toUpperCase() : "—"}</strong></div>
        <div className="info-row"><span>faces</span><strong className="mono">{model ? faceCount.toLocaleString() : "—"}</strong></div>
      </div>
    </WorkflowPanel>
  );
}
