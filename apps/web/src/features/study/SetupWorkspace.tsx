import { useEffect, useMemo, useRef, useState } from "react";
import { BoxSelect, CircleDot, Crosshair, MousePointer2, Orbit, Paintbrush, Scissors, Sparkles, Upload } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useStudyStore, type WorkspaceTool } from "../../app/store";
import { isApiSolver } from "../../app/api";
import { ViewerCanvas } from "../../components/ViewerCanvas";
import {
  applyFaceLabels,
  buildConstraintGroups,
  initializeFaceLabels,
  nextSequentialId
} from "../../lib/studyState";
import { parseModelFile } from "../../lib/modelParsers";
import { MATERIAL_OPTIONS } from "../../materials";
import type { ForceState, RegionLabel } from "../../types";
import { evaluateReadiness } from "./readiness";
import { buildSamplePreset } from "./samplePreset";
import { usePreviewSolver } from "./usePreviewSolver";
import { usePlatformSolver } from "./usePlatformSolver";

const STEPS = ["Model", "Regions", "Loads", "Objectives", "Manufacturing", "Review & Run"];

function stageLabel(stage: string): string {
  return stage.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function SetupWorkspace() {
  const navigate = useNavigate();
  const { projectId = "local" } = useParams();
  const fileInput = useRef<HTMLInputElement>(null);
  const runPreview = usePreviewSolver();
  const runPlatform = usePlatformSolver(projectId);
  const [activeStep, setActiveStep] = useState("Model");
  const state = useStudyStore();
  const {
    model, faceLabels, settings, loadCases, selectedLoadCaseId, forces, selectedForceId,
    paintLabel, brushRadius, placeForceMode, tool, qualityProfile, jobStatus, error, isRunning
  } = state;

  const constraintGroups = useMemo(
    () => model ? buildConstraintGroups(model.solveGeometry, faceLabels) : { fixedRegions: [], preservedRegions: [], obstacleRegions: [] },
    [model, faceLabels]
  );
  const readiness = useMemo(
    () => evaluateReadiness({ model, faceLabels, forces, loadCases }),
    [model, faceLabels, forces, loadCases]
  );
  const selectedForce = forces.find((force) => force.id === selectedForceId) ?? null;

  useEffect(() => {
    const valid = new Set(constraintGroups.fixedRegions.map((region) => region.id));
    const fallback = constraintGroups.fixedRegions[0]?.id;
    state.set({
      loadCases: loadCases.map((loadCase) => {
        const retained = loadCase.fixedRegionIds.filter((id) => valid.has(id));
        return { ...loadCase, fixedRegionIds: retained.length ? retained : fallback ? [fallback] : [] };
      })
    });
    // Region ids change only when the painted topology changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constraintGroups.fixedRegions.map((region) => region.id).join(":")]);

  async function loadFile(file: File, applySamplePreset = false) {
    try {
      state.set({ error: null });
      const parsed = await parseModelFile(file);
      const count = parsed.geometry.attributes.position.count / 3;
      if (applySamplePreset) {
        const preset = buildSamplePreset(parsed);
        state.resetForModel(parsed, preset.labels);
        state.set({ forces: [preset.force], selectedForceId: preset.force.id });
        setActiveStep("Review & Run");
      } else {
        state.resetForModel(parsed, initializeFaceLabels(count));
        setActiveStep("Regions");
      }
    } catch (cause) {
      state.set({ error: cause instanceof Error ? cause.message : "Unable to parse model." });
    }
  }

  async function loadSample() {
    const response = await fetch("/samples/connecting_rod_sample.obj");
    if (!response.ok) throw new Error("The sample model is unavailable.");
    await loadFile(new File([await response.blob()], "connecting_rod_sample.obj", { type: "text/plain" }), true);
  }

  function selectTool(next: WorkspaceTool) {
    const nextLabel: RegionLabel | null = next === "paint" ? paintLabel ?? "preserved" : null;
    state.set({ tool: next, paintLabel: nextLabel, placeForceMode: false });
  }

  function addForce(point: [number, number, number], normal: [number, number, number]) {
    const id = nextSequentialId(forces.map((force) => force.id), "F");
    const loadCaseId = selectedLoadCaseId || "LC-1";
    const force: ForceState = {
      id, loadCaseId, point, normal, direction: normal, magnitude: 1200, unit: "N", label: `${id} (1200 N)`
    };
    state.set({ forces: [...forces, force], selectedForceId: id, placeForceMode: false, tool: "select" });
  }

  function updateForce(patch: Partial<ForceState>) {
    if (!selectedForce) return;
    state.set({
      forces: forces.map((force) => force.id === selectedForce.id
        ? { ...force, ...patch, label: `${force.id} (${patch.magnitude ?? force.magnitude} ${patch.unit ?? force.unit})` }
        : force)
    });
  }

  async function run() {
    if (!readiness.ready) {
      state.set({ error: `Study is not ready: ${readiness.blockers.join(", ")}.` });
      return;
    }
    try {
      await (isApiSolver() ? runPlatform() : runPreview());
      navigate(`/projects/${projectId}/results?view=outcome&outcome=OUT-01&metric=outcome`);
    } catch {
      // The solver hook owns the user-facing error state.
    }
  }

  return (
    <main className="setup-workspace">
      <aside className="workflow-rail" aria-label="Study workflow">
        <div className="rail-heading"><span>STUDY SETUP</span><strong>{state.projectName}</strong></div>
        <ol>
          {STEPS.map((step, index) => (
            <li key={step}>
              <button type="button" className={activeStep === step ? "is-active" : ""} onClick={() => setActiveStep(step)}>
                <span>{String(index + 1).padStart(2, "0")}</span>{step}
              </button>
            </li>
          ))}
        </ol>
        <div className="rail-summary">
          <span>{readiness.completed}/{readiness.total} required checks</span>
          <div className="mini-progress"><i style={{ width: `${(readiness.completed / readiness.total) * 100}%` }} /></div>
        </div>
      </aside>

      <section className="canvas-stage" aria-label="Model workspace">
        <div className="canvas-toolbar" aria-label="Canvas tools">
          {([
            ["select", MousePointer2], ["paint", Paintbrush], ["orbit", Orbit], ["section", Scissors]
          ] as const).map(([name, Icon]) => (
            <button key={name} type="button" className={tool === name ? "is-active" : ""} onClick={() => selectTool(name)}>
              <Icon size={16} /><span>{name[0].toUpperCase() + name.slice(1)}</span>
            </button>
          ))}
        </div>
        {model ? (
          <ViewerCanvas
            geometry={model.geometry}
            faceLabels={faceLabels}
            paintLabel={tool === "paint" ? paintLabel : null}
            brushRadius={brushRadius}
            onPaintFaces={(indices, label) => state.set({ faceLabels: applyFaceLabels(faceLabels, indices, label) })}
            placeForceMode={placeForceMode}
            onPlaceForce={addForce}
            forces={forces}
            selectedForceId={selectedForceId}
            onSelectForce={(id) => state.set({ selectedForceId: id })}
            outcomeObject={null}
            showOriginal
            showOutcomeOverlay={false}
            wireframe={false}
          />
        ) : (
          <div className="model-empty-state">
            <BoxSelect size={42} />
            <h1>Start with a structural part</h1>
            <p>Load an STL, OBJ, or GLB model to define preserved interfaces, supports, and loads.</p>
            <div><button className="primary-button" type="button" onClick={() => fileInput.current?.click()}><Upload size={16} />Upload model</button>
            <button className="secondary-button" type="button" onClick={() => void loadSample()}>Use sample part</button></div>
          </div>
        )}
        <input ref={fileInput} hidden type="file" accept=".stl,.obj,.glb" onChange={(event) => event.target.files?.[0] && void loadFile(event.target.files[0])} />
        <div className="viewport-legend" aria-label="Region legend">
          <span><i className="preserved" />Preserved</span><span><i className="fixed" />Fixed</span>
          <span><i className="obstacle" />Obstacle</span><span><i className="load" />Load</span>
        </div>
        <div className="preview-badge"><CircleDot size={13} />PREVIEW AUTHORING</div>
      </section>

      <aside className="inspector">
        <div className="inspector-title"><span>{activeStep.toUpperCase()}</span><strong>{activeStep === "Model" ? "Source geometry" : `Configure ${activeStep.toLowerCase()}`}</strong></div>
        {activeStep === "Model" && <section className="inspector-section">
          <h2>Geometry</h2>
          <dl className="property-table">
            <div><dt>File</dt><dd>{model?.fileName ?? "Not loaded"}</dd></div>
            <div><dt>Format</dt><dd>{model?.format.toUpperCase() ?? "—"}</dd></div>
            <div><dt>Triangles</dt><dd>{model ? Math.round(model.geometry.attributes.position.count / 3).toLocaleString() : "—"}</dd></div>
          </dl>
          <button className="secondary-button full" type="button" onClick={() => fileInput.current?.click()}><Upload size={15} />{model ? "Replace model" : "Upload model"}</button>
        </section>}
        {activeStep === "Regions" && <section className="inspector-section">
          <h2>Region brush</h2>
          <div className="segmented region-modes">
            {(["preserved", "fixed", "obstacle", "design"] as RegionLabel[]).map((label) => <button key={label} type="button" className={paintLabel === label ? "is-active" : ""} onClick={() => state.set({ tool: "paint", paintLabel: label })}>{label}</button>)}
          </div>
          <label className="field-label">Brush radius <output>{Math.round(brushRadius * 100)}%</output><input type="range" min="0.01" max="0.2" step="0.01" value={brushRadius} onChange={(e) => state.set({ brushRadius: Number(e.target.value) })} /></label>
          <dl className="property-table">
            <div><dt>Preserved groups</dt><dd>{constraintGroups.preservedRegions.length}</dd></div>
            <div><dt>Fixed groups</dt><dd>{constraintGroups.fixedRegions.length}</dd></div>
            <div><dt>Obstacle groups</dt><dd>{constraintGroups.obstacleRegions.length}</dd></div>
          </dl>
        </section>}
        {activeStep === "Loads" && <section className="inspector-section">
          <h2>Load cases</h2>
          <div className="load-case-row"><strong>{selectedLoadCaseId}</strong><span>{forces.filter((force) => force.loadCaseId === selectedLoadCaseId).length} loads</span></div>
          <button className={placeForceMode ? "primary-button full" : "secondary-button full"} type="button" onClick={() => state.set({ placeForceMode: !placeForceMode, paintLabel: null, tool: "select" })}><Crosshair size={15} />{placeForceMode ? "Click a model face" : "Place force"}</button>
          {selectedForce && <div className="field-grid">
            <label>Magnitude<input type="number" min="0" value={selectedForce.magnitude} onChange={(e) => updateForce({ magnitude: Number(e.target.value) })} /></label>
            <label>Unit<select value={selectedForce.unit} onChange={(e) => updateForce({ unit: e.target.value as "N" | "lb" })}><option>N</option><option>lb</option></select></label>
          </div>}
        </section>}
        {activeStep === "Objectives" && <section className="inspector-section field-stack">
          <h2>Performance targets</h2>
          <label>Material<select value={settings.material} onChange={(e) => state.set({ settings: { ...settings, material: e.target.value as typeof settings.material } })}>{MATERIAL_OPTIONS.map((material) => <option key={material}>{material}</option>)}</select></label>
          <label>Target safety factor<input type="number" min="1" step="0.1" value={settings.targetSafetyFactor} onChange={(e) => state.set({ settings: { ...settings, targetSafetyFactor: Number(e.target.value) } })} /></label>
          <label>Mass reduction goal<input type="number" min="1" max="90" value={settings.massReductionGoalPct} onChange={(e) => state.set({ settings: { ...settings, massReductionGoalPct: Number(e.target.value) } })} /></label>
          <label>Outcome count<input type="number" min="2" max="8" value={settings.outcomeCount} onChange={(e) => state.set({ settings: { ...settings, outcomeCount: Number(e.target.value) } })} /></label>
        </section>}
        {activeStep === "Manufacturing" && <section className="inspector-section field-stack">
          <h2>Manufacturing constraints</h2>
          <label>Process<select defaultValue="unconstrained"><option value="unconstrained">Unconstrained preview</option><option value="additive">Additive</option><option value="milling">3-axis milling</option></select></label>
          <label>Minimum thickness<input type="number" defaultValue="2.0" min="0.1" step="0.1" /></label>
          <p className="helper-copy">Manufacturing constraints are recorded with the study. The current preview solver does not verify machinability.</p>
        </section>}
        {activeStep === "Review & Run" && <section className="inspector-section">
          <h2>Readiness checks</h2>
          <ul className="check-list">{readiness.checks.map((check) => <li key={check.label} className={check.complete ? "pass" : "pending"}><span>{check.complete ? "✓" : "—"}</span>{check.label}</li>)}</ul>
          <label className="field-label">Preview quality<select value={qualityProfile} onChange={(e) => state.set({ qualityProfile: e.target.value as typeof qualityProfile })}><option value="fast-preview">Fast preview</option><option value="balanced">Balanced</option><option value="high-fidelity">High fidelity preview</option></select></label>
        </section>}
        <section className="copilot-card"><Sparkles size={16} /><div><strong>Study Copilot</strong><p>Ask why a readiness check is blocked or how to improve the study definition.</p></div><button type="button" aria-label="Open Study Copilot">Open</button></section>
      </aside>

      <footer className="readiness-bar">
        <div><span className={readiness.ready ? "status-dot ready" : "status-dot"} /><div><strong>{readiness.ready ? "Ready for preview" : `${readiness.completed} of ${readiness.total} checks complete`}</strong><small>{readiness.ready ? "Run locally, then verify promising outcomes with an external FEA tool." : readiness.blockers.slice(0, 2).join(" · ")}</small></div></div>
        {jobStatus && isRunning && <div className="run-progress"><span>{stageLabel(jobStatus.stage)}</span><progress max="1" value={jobStatus.progress} /></div>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="run-button" type="button" disabled={!readiness.ready || isRunning} onClick={() => void run()}>{isRunning ? "Running preview…" : "Run preview study"}</button>
      </footer>
    </main>
  );
}
