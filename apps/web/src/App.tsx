import { useEffect, useMemo, useState } from "react";
import type { Outcome } from "@contracts/index";
import * as THREE from "three";

import { OutcomeTiles } from "./components/OutcomeTiles";
import { ViewerCanvas } from "./components/ViewerCanvas";
import { parseGlbFromBase64, parseModelFile } from "./lib/modelParsers";
import { applyFaceLabels, buildSolvePayload, getPreservedFaceIndices, initializeFaceLabels } from "./lib/studyState";
import type { ForceState, JobStatus, RegionLabel, StudySettings, UploadedModel } from "./types";
import "./styles.css";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
const apiUrl = (path: string) => (API_BASE ? `${API_BASE}${path}` : path);

const STAGES: JobStatus["stage"][] = [
  "queued",
  "parse",
  "voxelize",
  "field-solve",
  "variant-synth",
  "export",
  "complete"
];

function stageLabel(stage: JobStatus["stage"]): string {
  switch (stage) {
    case "field-solve":
      return "Field Solve";
    case "variant-synth":
      return "Variant Synthesis";
    default:
      return stage.replace("-", " ");
  }
}

export default function App() {
  const [model, setModel] = useState<UploadedModel | null>(null);
  const [faceLabels, setFaceLabels] = useState<RegionLabel[]>([]);
  const [paintLabel, setPaintLabel] = useState<RegionLabel | null>("preserved");
  const [brushRadius, setBrushRadius] = useState(0.06);
  const [placeForceMode, setPlaceForceMode] = useState(false);
  const [forces, setForces] = useState<ForceState[]>([]);
  const [selectedForceId, setSelectedForceId] = useState<string | null>(null);

  const [settings, setSettings] = useState<StudySettings>({
    units: "mm",
    material: "Aluminum 6061",
    targetSafetyFactor: 2,
    manufacturingConstraint: "Additive",
    outcomeCount: 4
  });

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string | null>(null);
  const [selectedOutcomeObject, setSelectedOutcomeObject] = useState<THREE.Object3D | null>(null);
  const [showOriginal, setShowOriginal] = useState(true);
  const [showOutcomeOverlay, setShowOutcomeOverlay] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [isSubmittingStudy, setIsSubmittingStudy] = useState(false);

  const selectedForce = useMemo(
    () => forces.find((force) => force.id === selectedForceId) ?? null,
    [forces, selectedForceId]
  );

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let active = true;

    const poll = async () => {
      try {
        const response = await fetch(apiUrl(`/api/jobs/${jobId}`));
        if (!response.ok) {
          throw new Error(`Status request failed (${response.status})`);
        }

        const payload = (await response.json()) as JobStatus;
        if (!active) {
          return;
        }

        setJobStatus(payload);

        if (payload.status === "succeeded") {
          setOutcomes(payload.outcomes ?? []);
          setSelectedOutcomeId(payload.outcomes?.[0]?.id ?? null);
          setJobId(null);
        }

        if (payload.status === "failed" || payload.status === "canceled") {
          setError(payload.error ?? "Study failed");
          setJobId(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to poll job status");
          setJobId(null);
        }
      }
    };

    poll();
    const handle = window.setInterval(poll, 1000);

    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [jobId]);

  useEffect(() => {
    if (!selectedOutcomeId) {
      setSelectedOutcomeObject(null);
      return;
    }

    const selected = outcomes.find((outcome) => outcome.id === selectedOutcomeId);
    if (!selected) {
      setSelectedOutcomeObject(null);
      return;
    }

    let active = true;
    parseGlbFromBase64(selected.optimizedModel.dataBase64)
      .then((scene) => {
        if (active) {
          setSelectedOutcomeObject(scene);
        }
      })
      .catch(() => {
        if (active) {
          setSelectedOutcomeObject(null);
        }
      });

    return () => {
      active = false;
    };
  }, [outcomes, selectedOutcomeId]);

  const preservedCount = useMemo(() => getPreservedFaceIndices(faceLabels).length, [faceLabels]);

  const onUploadFile = async (file: File) => {
    setError(null);
    const parsed = await parseModelFile(file);
    const faceCount = parsed.geometry.attributes.position.count / 3;

    setModel(parsed);
    setFaceLabels(initializeFaceLabels(faceCount));
    setForces([]);
    setSelectedForceId(null);
    setOutcomes([]);
    setSelectedOutcomeId(null);
    setSelectedOutcomeObject(null);
  };

  const loadSamplePart = async () => {
    const response = await fetch("/samples/connecting_rod_sample.obj");
    if (!response.ok) {
      throw new Error("Unable to load sample model from /samples");
    }
    const blob = await response.blob();
    const file = new File([blob], "connecting_rod_sample.obj", { type: "text/plain" });
    await onUploadFile(file);
  };

  const addForce = (point: [number, number, number], normal: [number, number, number]) => {
    const id = `F-${forces.length + 1}`;
    const force: ForceState = {
      id,
      point,
      direction: normal,
      normal,
      magnitude: 10,
      unit: "lb",
      label: `${id} (10 lb)`
    };
    setForces((current) => [...current, force]);
    setSelectedForceId(id);
    setPlaceForceMode(false);
  };

  const updateForce = (forceId: string, patch: Partial<ForceState>) => {
    setForces((current) =>
      current.map((force) => {
        if (force.id !== forceId) {
          return force;
        }
        const next = { ...force, ...patch };
        next.label = `${next.id} (${next.magnitude} ${next.unit})`;
        return next;
      })
    );
  };

  const removeForce = (forceId: string) => {
    setForces((current) => current.filter((force) => force.id !== forceId));
    setSelectedForceId((current) => (current === forceId ? null : current));
  };

  const runStudy = async () => {
    if (isSubmittingStudy || jobId) {
      return;
    }

    if (!model) {
      setError("Upload a model before running a study.");
      return;
    }

    if (preservedCount === 0) {
      setError("Mark at least one preserved region before solve.");
      return;
    }

    if (forces.length === 0) {
      setError("Add at least one force before solve.");
      return;
    }

    setError(null);
    setOutcomes([]);
    setSelectedOutcomeId(null);
    setSelectedOutcomeObject(null);
    setIsSubmittingStudy(true);

    try {
      const payload = buildSolvePayload({
        model,
        units: settings.units,
        faceLabels,
        forces,
        material: settings.material,
        targetSafetyFactor: settings.targetSafetyFactor,
        outcomeCount: settings.outcomeCount,
        manufacturingConstraint: settings.manufacturingConstraint
      });

      const response = await fetch(apiUrl("/api/solve"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const text = await response.text();
        setError(`Solve request failed (${response.status}): ${text}`);
        return;
      }

      const accepted = (await response.json()) as { jobId: string };
      setJobId(accepted.jobId);
      setJobStatus({
        jobId: accepted.jobId,
        status: "queued",
        stage: "queued",
        progress: 0
      });
    } catch (err) {
      const apiTarget = API_BASE || "same origin (/api)";
      const message = err instanceof Error ? err.message : "Unknown network error";
      if (message.toLowerCase().includes("failed to fetch")) {
        setError(`Cannot reach API at ${apiTarget}. Set VITE_API_BASE to your backend URL.`);
      } else {
        setError(`Failed to start study: ${message}`);
      }
    } finally {
      setIsSubmittingStudy(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="control-panel">
        <header>
          <h1>OpenTOS Generative Design</h1>
          <p>Autodesk-inspired structural outcome studies for load-path-driven organic parts.</p>
        </header>

        <section className="panel-card">
          <h2>1. Upload</h2>
          <button type="button" onClick={() => void loadSamplePart().catch((err: unknown) => setError(err instanceof Error ? err.message : "Sample load failed"))}>
            Load Sample Connecting Rod
          </button>
          <input
            type="file"
            accept=".stl,.obj,.glb"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              void onUploadFile(file).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Could not parse uploaded model");
              });
            }}
          />
          <label>
            Units
            <select
              value={settings.units}
              onChange={(event) => setSettings((curr) => ({ ...curr, units: event.target.value as StudySettings["units"] }))}
            >
              <option value="mm">mm</option>
              <option value="in">in</option>
              <option value="m">m</option>
            </select>
          </label>
          {model && <p className="small-note">Loaded: {model.fileName}</p>}
        </section>

        <section className="panel-card">
          <h2>2. Preserve Geometry</h2>
          <div className="inline-buttons">
            <button
              type="button"
              className={paintLabel === "preserved" ? "is-active" : ""}
              onClick={() => {
                setPaintLabel("preserved");
                setPlaceForceMode(false);
              }}
            >
              Paint Preserved
            </button>
            <button
              type="button"
              className={paintLabel === "design" ? "is-active" : ""}
              onClick={() => {
                setPaintLabel("design");
                setPlaceForceMode(false);
              }}
            >
              Paint Design
            </button>
          </div>
          <label>
            Brush Radius
            <input
              type="range"
              min={0.02}
              max={0.2}
              step={0.01}
              value={brushRadius}
              onChange={(event) => setBrushRadius(Number(event.target.value))}
            />
          </label>
          <p className="small-note">Preserved faces: {preservedCount}</p>
        </section>

        <section className="panel-card">
          <h2>3. Loads</h2>
          <button
            type="button"
            className={placeForceMode ? "is-active" : ""}
            onClick={() => {
              setPlaceForceMode((current) => !current);
              setPaintLabel(null);
            }}
          >
            {placeForceMode ? "Click Surface to Place..." : "Add Force"}
          </button>

          <div className="force-list">
            {forces.map((force) => (
              <button
                key={force.id}
                type="button"
                className={`force-chip ${selectedForceId === force.id ? "is-active" : ""}`}
                onClick={() => setSelectedForceId(force.id)}
              >
                {force.label}
              </button>
            ))}
          </div>

          {selectedForce && (
            <div className="force-editor">
              <label>
                Magnitude
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={selectedForce.magnitude}
                  onChange={(event) => updateForce(selectedForce.id, { magnitude: Number(event.target.value) })}
                />
              </label>
              <label>
                Unit
                <select
                  value={selectedForce.unit}
                  onChange={(event) => updateForce(selectedForce.id, { unit: event.target.value as ForceState["unit"] })}
                >
                  <option value="lb">lb</option>
                  <option value="N">N</option>
                </select>
              </label>
              <label>
                Direction X
                <input
                  type="number"
                  step={0.1}
                  value={selectedForce.direction[0]}
                  onChange={(event) =>
                    updateForce(selectedForce.id, {
                      direction: [
                        Number(event.target.value),
                        selectedForce.direction[1],
                        selectedForce.direction[2]
                      ] as [number, number, number]
                    })
                  }
                />
              </label>
              <label>
                Direction Y
                <input
                  type="number"
                  step={0.1}
                  value={selectedForce.direction[1]}
                  onChange={(event) =>
                    updateForce(selectedForce.id, {
                      direction: [
                        selectedForce.direction[0],
                        Number(event.target.value),
                        selectedForce.direction[2]
                      ] as [number, number, number]
                    })
                  }
                />
              </label>
              <label>
                Direction Z
                <input
                  type="number"
                  step={0.1}
                  value={selectedForce.direction[2]}
                  onChange={(event) =>
                    updateForce(selectedForce.id, {
                      direction: [
                        selectedForce.direction[0],
                        selectedForce.direction[1],
                        Number(event.target.value)
                      ] as [number, number, number]
                    })
                  }
                />
              </label>
              <div className="inline-buttons">
                <button type="button" onClick={() => updateForce(selectedForce.id, { direction: selectedForce.normal })}>
                  Align to Face Normal
                </button>
                <button type="button" onClick={() => removeForce(selectedForce.id)}>
                  Remove
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="panel-card">
          <h2>4. Study Setup</h2>
          <label>
            Material
            <select value={settings.material} onChange={() => undefined}>
              <option value="Aluminum 6061">Aluminum 6061</option>
            </select>
          </label>
          <label>
            Safety Factor
            <input
              type="number"
              min={1}
              max={5}
              step={0.1}
              value={settings.targetSafetyFactor}
              onChange={(event) => setSettings((curr) => ({ ...curr, targetSafetyFactor: Number(event.target.value) }))}
            />
          </label>
          <label>
            Manufacturing
            <select
              value={settings.manufacturingConstraint}
              onChange={(event) =>
                setSettings((curr) => ({
                  ...curr,
                  manufacturingConstraint: event.target.value as StudySettings["manufacturingConstraint"]
                }))
              }
            >
              <option value="Additive">Additive</option>
              <option value="3-axis milling">3-axis milling</option>
            </select>
          </label>
          <label>
            Outcomes
            <input
              type="number"
              min={2}
              max={8}
              step={1}
              value={settings.outcomeCount}
              onChange={(event) => setSettings((curr) => ({ ...curr, outcomeCount: Number(event.target.value) }))}
            />
          </label>
          <button
            type="button"
            className="run-button"
            disabled={isSubmittingStudy || Boolean(jobId)}
            onClick={() => void runStudy()}
          >
            {isSubmittingStudy || jobId ? "Starting Study..." : "Run Generative Study"}
          </button>
          <p className="small-note run-hint">
            Required: model upload, at least 1 preserved face, and at least 1 force.
          </p>
          {error && <p className="panel-error">{error}</p>}
        </section>
      </aside>

      <main className="workspace">
        <section className="viewer-panel">
          <div className="viewer-toolbar">
            <div className="inline-buttons">
              <button type="button" className={showOriginal ? "is-active" : ""} onClick={() => setShowOriginal((v) => !v)}>
                Original
              </button>
              <button
                type="button"
                className={showOutcomeOverlay ? "is-active" : ""}
                onClick={() => setShowOutcomeOverlay((v) => !v)}
              >
                Generated
              </button>
              <button type="button" className={wireframe ? "is-active" : ""} onClick={() => setWireframe((v) => !v)}>
                Wireframe
              </button>
            </div>

            {jobStatus && (
              <div className="progress-wrap">
                <div className="progress-meta">
                  <span>{stageLabel(jobStatus.stage)}</span>
                  <strong>{Math.round(jobStatus.progress * 100)}%</strong>
                </div>
                <progress max={1} value={jobStatus.progress} />
                <div className="stage-track">
                  {STAGES.map((stage) => (
                    <span key={stage} className={STAGES.indexOf(stage) <= STAGES.indexOf(jobStatus.stage) ? "is-hit" : ""}>
                      {stageLabel(stage)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <ViewerCanvas
            geometry={model?.geometry ?? null}
            faceLabels={faceLabels}
            paintLabel={paintLabel}
            brushRadius={brushRadius}
            onPaintFaces={(indices) => {
              if (!paintLabel) {
                return;
              }
              setFaceLabels((current) => applyFaceLabels(current, indices, paintLabel));
            }}
            placeForceMode={placeForceMode}
            onPlaceForce={addForce}
            forces={forces}
            selectedForceId={selectedForceId}
            onSelectForce={setSelectedForceId}
            outcomeObject={selectedOutcomeObject}
            showOriginal={showOriginal}
            showOutcomeOverlay={showOutcomeOverlay}
            wireframe={wireframe}
          />
        </section>

        <section className="outcomes-panel">
          <div className="outcomes-header">
            <h2>Outcome View</h2>
            <p>{outcomes.length} outcomes generated</p>
          </div>
          {outcomes.length > 0 ? (
            <OutcomeTiles
              outcomes={outcomes}
              selectedOutcomeId={selectedOutcomeId}
              onSelectOutcome={setSelectedOutcomeId}
            />
          ) : (
            <p className="empty-state">Run a study to see Autodesk-style structural variants side-by-side.</p>
          )}
        </section>

        {error && <div className="error-banner">{error}</div>}
      </main>
    </div>
  );
}
