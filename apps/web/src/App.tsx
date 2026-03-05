import { useEffect, useMemo, useRef, useState } from "react";
import type { OutcomeV2 } from "@contracts/index";
import * as THREE from "three";

import { OutcomeTiles } from "./components/OutcomeTiles";
import { ViewerCanvas } from "./components/ViewerCanvas";
import { parseGlbFromBase64, parseModelFile } from "./lib/modelParsers";
import {
  applyFaceLabels,
  buildSolvePayload,
  getObstacleFaceIndices,
  getPreservedFaceIndices,
  initializeFaceLabels
} from "./lib/studyState";
import type {
  BrowserQualityProfile,
  ForceState,
  JobStatus,
  RegionLabel,
  StudySettings,
  UploadedModel
} from "./types";
import "./styles.css";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
const apiUrl = (path: string) => (API_BASE ? `${API_BASE}${path}` : path);
const SOLVER_MODE = import.meta.env.VITE_SOLVER_MODE === "api" ? "api" : "browser";

type BrowserWorkerMessage =
  | {
      type: "progress";
      stage: JobStatus["stage"];
      progress: number;
      status: JobStatus["status"];
      qualityProfile: BrowserQualityProfile;
      warnings: string[];
      etaSeconds?: number;
    }
  | {
      type: "result";
      outcomes: OutcomeV2[];
      qualityProfile: BrowserQualityProfile;
      warnings: string[];
    }
  | {
      type: "error";
      error: string;
    };

const STAGES: JobStatus["stage"][] = [
  "queued",
  "parse",
  "constraint-map",
  "voxelize",
  "fem-solve",
  "topology-opt",
  "reconstruct",
  "rank-export",
  "complete"
];

function stageLabel(stage: JobStatus["stage"]): string {
  switch (stage) {
    case "constraint-map":
      return "Constraint Map";
    case "fem-solve":
      return "FE Proxy Solve";
    case "topology-opt":
      return "Topology Optimization";
    case "rank-export":
      return "Rank & Export";
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
    outcomeCount: 4,
    massReductionGoalPct: 45
  });
  const [qualityProfile, setQualityProfile] = useState<BrowserQualityProfile>("high-fidelity");

  const [studyId, setStudyId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeV2[]>([]);
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string | null>(null);
  const [selectedOutcomeObject, setSelectedOutcomeObject] = useState<THREE.Object3D | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showOutcomeOverlay, setShowOutcomeOverlay] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [isSubmittingStudy, setIsSubmittingStudy] = useState(false);
  const [workerWarnings, setWorkerWarnings] = useState<string[]>([]);
  const workerRef = useRef<Worker | null>(null);

  const selectedForce = useMemo(
    () => forces.find((force) => force.id === selectedForceId) ?? null,
    [forces, selectedForceId]
  );
  const isBrowserSolver = SOLVER_MODE === "browser";

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

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
        setWorkerWarnings(payload.warnings ?? []);
        setStudyId(payload.studyId);

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
          if (model) {
            scene.position.set(
              model.solveToDisplayOffset[0],
              model.solveToDisplayOffset[1],
              model.solveToDisplayOffset[2]
            );
          }
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
  }, [model, outcomes, selectedOutcomeId]);

  const preservedCount = useMemo(() => getPreservedFaceIndices(faceLabels).length, [faceLabels]);
  const obstacleCount = useMemo(() => getObstacleFaceIndices(faceLabels).length, [faceLabels]);

  const onUploadFile = async (file: File) => {
    setError(null);
    setWorkerWarnings([]);
    const parsed = await parseModelFile(file);
    const faceCount = parsed.geometry.attributes.position.count / 3;

    setModel(parsed);
    setFaceLabels(initializeFaceLabels(faceCount));
    setForces([]);
    setSelectedForceId(null);
    setOutcomes([]);
    setSelectedOutcomeId(null);
    setSelectedOutcomeObject(null);
    setStudyId(null);
    setJobId(null);
    setJobStatus(null);
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
    setWorkerWarnings([]);
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
        massReductionGoalPct: settings.massReductionGoalPct
      });

      if (isBrowserSolver) {
        workerRef.current?.terminate();
        const worker = new Worker(new URL("./workers/solverWorker.ts", import.meta.url), { type: "module" });
        workerRef.current = worker;

        const solvePositionsAttr = model.solveGeometry.getAttribute("position");
        if (!(solvePositionsAttr instanceof THREE.BufferAttribute) || solvePositionsAttr.itemSize !== 3) {
          throw new Error("Loaded model has invalid solve geometry");
        }

        const transferablePositions = new Float32Array(solvePositionsAttr.array as Float32Array);
        setWorkerWarnings([]);
        setStudyId("browser-local");

        setJobStatus({
          jobId: "browser-local",
          studyId: "browser-local",
          status: "queued",
          stage: "queued",
          progress: 0,
          solverVersion: "opentos-v2-browser",
          qualityProfile,
          warnings: []
        });

        const localResult = await new Promise<{ outcomes: OutcomeV2[]; qualityProfile: BrowserQualityProfile; warnings: string[] }>(
          (resolve, reject) => {
            const cleanup = () => {
              worker.terminate();
              if (workerRef.current === worker) {
                workerRef.current = null;
              }
            };

            worker.onmessage = (event: MessageEvent<BrowserWorkerMessage>) => {
              const msg = event.data;
              if (!msg) {
                return;
              }

              if (msg.type === "progress") {
                setJobStatus({
                  jobId: "browser-local",
                  studyId: "browser-local",
                  status: msg.status,
                  stage: msg.stage,
                  progress: msg.progress,
                  solverVersion: "opentos-v2-browser",
                  qualityProfile: msg.qualityProfile,
                  warnings: msg.warnings,
                  etaSeconds: msg.etaSeconds
                });
                setWorkerWarnings(msg.warnings);
                return;
              }

              if (msg.type === "result") {
                cleanup();
                resolve({
                  outcomes: msg.outcomes,
                  qualityProfile: msg.qualityProfile,
                  warnings: msg.warnings
                });
                return;
              }

              cleanup();
              reject(new Error(msg.error || "Browser solver failed"));
            };

            worker.onerror = (event) => {
              cleanup();
              reject(new Error(event.message || "Browser worker crashed"));
            };

            worker.postMessage(
              {
                type: "solve",
                payload: {
                  request: payload,
                  geometry: { positions: transferablePositions },
                  qualityProfile
                }
              },
              [transferablePositions.buffer]
            );
          }
        );

        setOutcomes(localResult.outcomes);
        setSelectedOutcomeId(localResult.outcomes[0]?.id ?? null);
        setWorkerWarnings(localResult.warnings);
        setJobStatus((current) =>
          current
            ? {
                ...current,
                status: "succeeded",
                stage: "complete",
                progress: 1,
                qualityProfile: localResult.qualityProfile,
                warnings: localResult.warnings,
                etaSeconds: 0
              }
            : current
        );
        setJobId(null);
        return;
      }

      const createStudyResponse = await fetch(apiUrl("/api/studies"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!createStudyResponse.ok) {
        const text = await createStudyResponse.text();
        if ((createStudyResponse.status === 404 || createStudyResponse.status === 405) && !text.trim()) {
          const apiTarget = API_BASE || `${window.location.origin} (same-origin /api)`;
          setError(
            `API endpoint rejected POST (${createStudyResponse.status}). This deployment is likely serving static assets only. Configure VITE_API_BASE to your backend URL. Current target: ${apiTarget}`
          );
        } else {
          setError(`Study creation failed (${createStudyResponse.status}): ${text}`);
        }
        return;
      }

      const created = (await createStudyResponse.json()) as { study: { id: string } };
      const createdStudyId = created.study.id;
      setStudyId(createdStudyId);

      const runResponse = await fetch(apiUrl(`/api/studies/${createdStudyId}/run`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qualityProfile
        })
      });

      if (!runResponse.ok) {
        const text = await runResponse.text();
        setError(`Study run request failed (${runResponse.status}): ${text}`);
        return;
      }

      const accepted = (await runResponse.json()) as { jobId: string };
      setJobId(accepted.jobId);
      setJobStatus({
        jobId: accepted.jobId,
        studyId: createdStudyId,
        status: "queued",
        stage: "queued",
        progress: 0,
        warnings: [],
        solverVersion: "opentos-v2-api"
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown network error";
      if (!isBrowserSolver && message.toLowerCase().includes("failed to fetch")) {
        const apiTarget = API_BASE || "same origin (/api)";
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
              Select Preserved Surface
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
            <button
              type="button"
              className={paintLabel === "obstacle" ? "is-active" : ""}
              onClick={() => {
                setPaintLabel("obstacle");
                setPlaceForceMode(false);
              }}
            >
              Paint Obstacle
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
          <p className="small-note">
            Preserved mode: click once inside a through-hole to select its full inner surface.
          </p>
          <p className="small-note">Preserved faces: {preservedCount}</p>
          <p className="small-note">Obstacle faces: {obstacleCount}</p>
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
            Mass Reduction Goal (%)
            <input
              type="number"
              min={5}
              max={80}
              step={1}
              value={settings.massReductionGoalPct}
              onChange={(event) => setSettings((curr) => ({ ...curr, massReductionGoalPct: Number(event.target.value) }))}
            />
          </label>
          <label>
            Outcomes
            <input
              type="number"
              min={2}
              max={12}
              step={1}
              value={settings.outcomeCount}
              onChange={(event) => setSettings((curr) => ({ ...curr, outcomeCount: Number(event.target.value) }))}
            />
          </label>
          {isBrowserSolver && (
            <label>
              Browser Quality
              <select
                value={qualityProfile}
                onChange={(event) => setQualityProfile(event.target.value as BrowserQualityProfile)}
              >
                <option value="high-fidelity">High Fidelity</option>
                <option value="balanced">Balanced</option>
                <option value="fast-preview">Fast Preview</option>
              </select>
            </label>
          )}
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
          <p className="small-note run-hint">
            Solver mode: {isBrowserSolver ? "Browser (local compute)" : "API (remote compute)"}
          </p>
          {jobStatus?.qualityProfile && (
            <p className="small-note run-hint">Active quality: {jobStatus.qualityProfile}</p>
          )}
          {jobStatus?.etaSeconds != null && jobStatus.status === "running" && (
            <p className="small-note run-hint">ETA: ~{Math.max(0, jobStatus.etaSeconds)}s</p>
          )}
          {workerWarnings.length > 0 && (
            <div className="panel-warning">
              {workerWarnings.map((warning, idx) => (
                <p key={`${idx}-${warning}`}>{warning}</p>
              ))}
            </div>
          )}
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
                    <span
                      key={stage}
                      className={
                        STAGES.indexOf(stage) <=
                        Math.max(0, STAGES.indexOf(jobStatus.stage === "failed" ? "complete" : jobStatus.stage))
                          ? "is-hit"
                          : ""
                      }
                    >
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
