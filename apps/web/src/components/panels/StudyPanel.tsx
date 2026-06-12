import { MATERIAL_OPTIONS } from "../../materials";
import type { BrowserQualityProfile, StudySettings } from "../../types";
import { WorkflowPanel } from "../WorkflowPanel";

interface StudyPanelProps {
  settings: StudySettings;
  onSettingsChange: (patch: Partial<StudySettings>) => void;
  qualityProfile: BrowserQualityProfile;
  onQualityProfileChange: (profile: BrowserQualityProfile) => void;
  isBrowserSolver: boolean;
}

export function StudyPanel({
  settings,
  onSettingsChange,
  qualityProfile,
  onQualityProfileChange,
  isBrowserSolver
}: StudyPanelProps) {
  return (
    <WorkflowPanel
      step="study"
      helper="Set material and optimization targets. Metrics are deterministic proxies, not certified FEA values."
    >
      <label className="field">
        Material
        <select
          value={settings.material}
          onChange={(event) => onSettingsChange({ material: event.target.value as StudySettings["material"] })}
        >
          {MATERIAL_OPTIONS.map((materialName) => (
            <option key={materialName} value={materialName}>
              {materialName}
            </option>
          ))}
        </select>
        <small className="field-hint">Drives mass, stress, and safety proxies.</small>
      </label>

      <div className="field-pair">
        <label className="field">
          Safety factor
          <input
            type="number"
            min={1}
            max={5}
            step={0.1}
            value={settings.targetSafetyFactor}
            onChange={(event) => onSettingsChange({ targetSafetyFactor: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          Mass goal (%)
          <input
            type="number"
            min={5}
            max={80}
            step={1}
            value={settings.massReductionGoalPct}
            onChange={(event) => onSettingsChange({ massReductionGoalPct: Number(event.target.value) })}
          />
        </label>
      </div>
      <small className="field-hint">Mass goal is the reduction target versus the original part volume.</small>

      <label className="field">
        Outcomes
        <input
          type="number"
          min={2}
          max={12}
          step={1}
          value={settings.outcomeCount}
          onChange={(event) => onSettingsChange({ outcomeCount: Number(event.target.value) })}
        />
        <small className="field-hint">Distinct design variants to synthesize and rank (2–12).</small>
      </label>

      {isBrowserSolver && (
        <label className="field">
          Quality profile
          <select
            value={qualityProfile}
            onChange={(event) => onQualityProfileChange(event.target.value as BrowserQualityProfile)}
          >
            <option value="high-fidelity">High fidelity — slowest, most organic</option>
            <option value="balanced">Balanced</option>
            <option value="fast-preview">Fast preview — quickest turnaround</option>
          </select>
        </label>
      )}

      <div className="info-rows">
        <div className="info-row">
          <span>solver</span>
          <strong className="mono">{isBrowserSolver ? "browser worker" : "remote api"}</strong>
        </div>
      </div>
    </WorkflowPanel>
  );
}
