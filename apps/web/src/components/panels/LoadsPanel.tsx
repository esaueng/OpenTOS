import { Crosshair, Plus, Trash2 } from "lucide-react";
import type { FaceRegion } from "@contracts/index";

import type { ForceState, LoadCaseState } from "../../types";
import { WorkflowPanel } from "../WorkflowPanel";

interface LoadsPanelProps {
  loadCases: LoadCaseState[];
  selectedLoadCaseId: string;
  forces: ForceState[];
  selectedForceId: string | null;
  fixedRegions: FaceRegion[];
  placeForceMode: boolean;
  showAllForces: boolean;
  onSelectLoadCase: (loadCaseId: string) => void;
  onAddLoadCase: () => void;
  onRemoveLoadCase: (loadCaseId: string) => void;
  onUpdateLoadCase: (loadCaseId: string, patch: Partial<LoadCaseState>) => void;
  onTogglePlaceForce: () => void;
  onShowAllForcesChange: (showAll: boolean) => void;
  onSelectForce: (forceId: string | null) => void;
  onUpdateForce: (forceId: string, patch: Partial<ForceState>) => void;
  onRemoveForce: (forceId: string) => void;
}

export function LoadsPanel({
  loadCases,
  selectedLoadCaseId,
  forces,
  selectedForceId,
  fixedRegions,
  placeForceMode,
  showAllForces,
  onSelectLoadCase,
  onAddLoadCase,
  onRemoveLoadCase,
  onUpdateLoadCase,
  onTogglePlaceForce,
  onShowAllForcesChange,
  onSelectForce,
  onUpdateForce,
  onRemoveForce
}: LoadsPanelProps) {
  const selectedLoadCase = loadCases.find((loadCase) => loadCase.id === selectedLoadCaseId) ?? null;
  const selectedForce = forces.find((force) => force.id === selectedForceId) ?? null;
  const visibleForces = showAllForces ? forces : forces.filter((force) => force.loadCaseId === selectedLoadCaseId);

  return (
    <WorkflowPanel
      step="loads"
      helper="Place forces on the part and group them into load cases. Each load case must reference at least one fixed interface."
    >
      <div className="subsection-head">
        <span className="section-title">Load cases</span>
        <button type="button" className="secondary compact" onClick={onAddLoadCase}>
          <Plus size={13} aria-hidden="true" />
          Add case
        </button>
      </div>
      <div className="chip-row" role="list" aria-label="Load cases">
        {loadCases.map((loadCase) => {
          const count = forces.filter((force) => force.loadCaseId === loadCase.id).length;
          return (
            <button
              key={loadCase.id}
              type="button"
              role="listitem"
              className={`chip ${selectedLoadCaseId === loadCase.id ? "active" : ""}`}
              onClick={() => onSelectLoadCase(loadCase.id)}
            >
              <span className="mono">{loadCase.id}</span>
              <b>{count}</b>
            </button>
          );
        })}
      </div>

      {selectedLoadCase && (
        <div className="editor-card">
          <span className="section-title">Fixed interfaces for {selectedLoadCase.id}</span>
          {fixedRegions.length > 0 ? (
            <div className="chip-row">
              {fixedRegions.map((region) => {
                const active = selectedLoadCase.fixedRegionIds.includes(region.id);
                return (
                  <button
                    key={region.id}
                    type="button"
                    className={`chip anchor ${active ? "active" : ""}`}
                    aria-pressed={active}
                    onClick={() =>
                      onUpdateLoadCase(selectedLoadCase.id, {
                        fixedRegionIds: active
                          ? selectedLoadCase.fixedRegionIds.filter((regionId) => regionId !== region.id)
                          : [...selectedLoadCase.fixedRegionIds, region.id]
                      })
                    }
                  >
                    <span className="mono">{region.id}</span>
                    <b>{region.faceIndices.length}</b>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="panel-copy empty-copy">Mark fixed surfaces in the Constraints step to define boundary conditions.</p>
          )}
          <div className="button-grid">
            <button
              type="button"
              className="secondary compact"
              disabled={fixedRegions.length === 0}
              onClick={() => onUpdateLoadCase(selectedLoadCase.id, { fixedRegionIds: fixedRegions.map((region) => region.id) })}
            >
              Use all fixed
            </button>
            <button
              type="button"
              className="secondary compact"
              disabled={loadCases.length <= 1}
              onClick={() => onRemoveLoadCase(selectedLoadCase.id)}
            >
              <Trash2 size={13} aria-hidden="true" />
              Remove case
            </button>
          </div>
        </div>
      )}

      <div className="subsection-head">
        <span className="section-title">Forces</span>
        <div className="segmented compact-segment" role="group" aria-label="Force list filter">
          <button type="button" className={showAllForces ? "active" : ""} onClick={() => onShowAllForcesChange(true)}>
            All
          </button>
          <button type="button" className={!showAllForces ? "active" : ""} onClick={() => onShowAllForcesChange(false)}>
            Case
          </button>
        </div>
      </div>
      <button
        type="button"
        className={`tool-button wide ${placeForceMode ? "active" : ""}`}
        onClick={onTogglePlaceForce}
        aria-pressed={placeForceMode}
      >
        <Crosshair size={15} aria-hidden="true" />
        {placeForceMode ? "Click a surface to place…" : "Add force"}
      </button>

      {visibleForces.length > 0 ? (
        <div className="chip-row" role="list" aria-label="Forces">
          {visibleForces.map((force) => (
            <button
              key={force.id}
              type="button"
              role="listitem"
              className={`chip force ${selectedForceId === force.id ? "active" : ""}`}
              onClick={() => {
                onSelectForce(force.id);
                onSelectLoadCase(force.loadCaseId);
              }}
            >
              <span className="mono">{force.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="panel-copy empty-copy">No forces yet. New forces default to 10 lb along the surface normal.</p>
      )}

      {selectedForce && (
        <div className="editor-card" aria-label={`Edit ${selectedForce.id}`}>
          <span className="section-title">Edit {selectedForce.id}</span>
          <label className="field">
            Load case
            <select
              value={selectedForce.loadCaseId}
              onChange={(event) => onUpdateForce(selectedForce.id, { loadCaseId: event.target.value })}
            >
              {loadCases.map((loadCase) => (
                <option key={loadCase.id} value={loadCase.id}>
                  {loadCase.id}
                </option>
              ))}
            </select>
          </label>
          <div className="field-pair">
            <label className="field">
              Magnitude
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={selectedForce.magnitude}
                onChange={(event) => onUpdateForce(selectedForce.id, { magnitude: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              Unit
              <select
                value={selectedForce.unit}
                onChange={(event) => onUpdateForce(selectedForce.id, { unit: event.target.value as ForceState["unit"] })}
              >
                <option value="lb">lb</option>
                <option value="N">N</option>
              </select>
            </label>
          </div>
          <span className="field-label">Direction</span>
          <div className="direction-grid">
            {(["X", "Y", "Z"] as const).map((axis, axisIndex) => (
              <label key={axis} className="field direction-field">
                <span className="mono">{axis}</span>
                <input
                  type="number"
                  step={0.1}
                  value={selectedForce.direction[axisIndex]}
                  onChange={(event) => {
                    const next = [...selectedForce.direction] as [number, number, number];
                    next[axisIndex] = Number(event.target.value);
                    onUpdateForce(selectedForce.id, { direction: next });
                  }}
                />
              </label>
            ))}
          </div>
          <div className="button-grid">
            <button
              type="button"
              className="secondary compact"
              onClick={() => onUpdateForce(selectedForce.id, { direction: selectedForce.normal })}
            >
              Align to normal
            </button>
            <button type="button" className="secondary compact" onClick={() => onRemoveForce(selectedForce.id)}>
              <Trash2 size={13} aria-hidden="true" />
              Remove force
            </button>
          </div>
        </div>
      )}
    </WorkflowPanel>
  );
}
