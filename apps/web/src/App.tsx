import { useEffect, useMemo, useRef, useState } from "react";
import type { OutcomeV2 } from "@contracts/index";
import * as THREE from "three";

import { AppShell } from "./components/AppShell";
import { ContextPanel } from "./components/ContextPanel";
import { GenerativeDesignViewer } from "./components/GenerativeDesignViewer";
import { OutcomePanel } from "./components/OutcomePanel";
import { SelectionLegend } from "./components/SelectionLegend";
import { StatusBar, type WorkspaceStatusTone } from "./components/StatusBar";
import { StepBar } from "./components/StepBar";
import { TopBar } from "./components/TopBar";
import { ViewerShell } from "./components/ViewerShell";
import { ViewerToolbar } from "./components/ViewerToolbar";
import { ConstraintsPanel } from "./components/panels/ConstraintsPanel";
import { GeneratePanel } from "./components/panels/GeneratePanel";
import { LoadsPanel } from "./components/panels/LoadsPanel";
import { ModelPanel } from "./components/panels/ModelPanel";
import { PreservePanel } from "./components/panels/PreservePanel";
import { ResultsPanel } from "./components/panels/ResultsPanel";
import { StudyPanel } from "./components/panels/StudyPanel";
import { parseGlbFromBase64, parseModelFile } from "./lib/modelParsers";
import {
  applyFaceLabels,
  buildConstraintGroups,
  buildSolvePayload,
  getFixedFaceIndices,
  getObstacleFaceIndices,
  getPreservedFaceIndices,
  initializeFaceLabels,
  nextSequentialId
} from "./lib/studyState";
import {
  canNavigateToStep,
  canRunStudy,
  missingRunItems,
  nextStep,
  previousStep,
  runChecklist,
  type StepId,
  type WorkflowSnapshot
} from "./lib/workflow";
import type {
  BrowserQualityProfile,
  ForceState,
  JobStatus,
  LoadCaseState,
  RegionLabel,
  StudySettings,
  UploadedModel
} from "./types";

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

function defaultLoadCase(id = "LC-1"): LoadCaseState {
  return {
    id,
    fixedRegionIds: []
  };
}

export default function App() {
  const [activeStep, setActiveStep] = useState<StepId>("model");
  const [model, setModel] = useState<UploadedModel | null>(null);
  const [faceLabels, setFaceLabels] = useState<RegionLabel[]>([]);
  const [paintLabel, setPaintLabel] = useState<RegionLabel | null>(null);
  const [brushRadius, setBrushRadius] = useState(0.06);
  const [placeForceMode, setPlaceForceMode] = useState(false);
  const [loadCases, setLoadCases] = useState<LoadCaseState[]>([defaultLoadCase()]);
  const [selectedLoadCaseId, setSelectedLoadCaseId] = useState<string>("LC-1");
  const [forces, setForces] = useState<ForceState[]>([]);
  const [selectedForceId, setSelectedForceId] = useState<string | null>(null);
  const [showAllForces, setShowAllForces] = useState(true);

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
  // The part must stay visible on every step after load; editing modes force
  // it on regardless, this only affects passive steps (Study/Generate/Results).
  const [showOriginal, setShowOriginal] = useState(true);
  const [showOutcomeOverlay, setShowOutcomeOverlay] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);
  const [isSubmittingStudy, setIsSubmittingStudy] = useState(false);
  const [workerWarnings, setWorkerWarnings] = useState<string[]>([]);
  const workerRef = useRef<Worker | null>(null);

  const isBrowserSolver = SOLVER_MODE === "browser";
  const constraintGroups = useMemo(
    () =>
      model
        ? buildConstraintGroups(model.solveGeometry, faceLabels)
        : { fixedRegions: [], preservedRegions: [], obstacleRegions: [] },
    [faceLabels, model]
  );

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
          setShowOriginal(true);
          setShowOutcomeOverlay(true);
          setJobId(null);
          setActiveStep("results");
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
  const fixedCount = useMemo(() => getFixedFaceIndices(faceLabels).length, [faceLabels]);
  const obstacleCount = useMemo(() => getObstacleFaceIndices(faceLabels).length, [faceLabels]);

  const running = isSubmittingStudy || Boolean(jobId);
  const snapshot: WorkflowSnapshot = useMemo(
    () => ({
      hasModel: Boolean(model),
      preservedCount,
      fixedCount,
      obstacleCount,
      forces,
      loadCases,
      outcomeCount: outcomes.length,
      running
    }),
    [model, preservedCount, fixedCount, obstacleCount, forces, loadCases, outcomes.length, running]
  );
  const checklist = useMemo(() => runChecklist(snapshot), [snapshot]);
  const missingItems = useMemo(() => missingRunItems(snapshot), [snapshot]);
  const canRun = canRunStudy(snapshot);

  const handleStepSelect = (step: StepId) => {
    setActiveStep(step);
    setPlaceForceMode(false);
    if (step === "preserve") {
      setPaintLabel("preserved");
    } else if (step === "constraints") {
      setPaintLabel("fixed");
    } else {
      setPaintLabel(null);
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "n" || event.key === "N") {
        const next = nextStep(activeStep);
        if (next && canNavigateToStep(next, snapshot)) {
          handleStepSelect(next);
        }
      } else if (event.key === "b" || event.key === "B") {
        const previous = previousStep(activeStep);
        if (previous) {
          handleStepSelect(previous);
        }
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activeStep, snapshot]);

  const onUploadFile = async (file: File) => {
    setError(null);
    setWorkerWarnings([]);
    const parsed = await parseModelFile(file);
    const faceCount = parsed.geometry.attributes.position.count / 3;

    setModel(parsed);
    setFaceLabels(initializeFaceLabels(faceCount));
    setLoadCases([defaultLoadCase()]);
    setSelectedLoadCaseId("LC-1");
    setForces([]);
    setSelectedForceId(null);
    setOutcomes([]);
    setSelectedOutcomeId(null);
    setSelectedOutcomeObject(null);
    setStudyId(null);
    setJobId(null);
    setJobStatus(null);
    handleStepSelect("preserve");
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
    let activeLoadCaseId = selectedLoadCaseId || loadCases[0]?.id || "LC-1";
    if (!loadCases.find((loadCase) => loadCase.id === activeLoadCaseId)) {
      const next = defaultLoadCase(nextSequentialId(loadCases.map((loadCase) => loadCase.id), "LC"));
      activeLoadCaseId = next.id;
      setLoadCases((current) => [...current, next]);
      setSelectedLoadCaseId(next.id);
    }
    const id = nextSequentialId(forces.map((force) => force.id), "F");
    const force: ForceState = {
      id,
      loadCaseId: activeLoadCaseId,
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

  const addLoadCase = () => {
    const next = defaultLoadCase(nextSequentialId(loadCases.map((loadCase) => loadCase.id), "LC"));
    setLoadCases((current) => [...current, next]);
    setSelectedLoadCaseId(next.id);
  };

  const updateLoadCase = (loadCaseId: string, patch: Partial<LoadCaseState>) => {
    setLoadCases((current) =>
      current.map((loadCase) =>
        loadCase.id === loadCaseId
          ? {
              ...loadCase,
              ...patch
            }
          : loadCase
      )
    );
  };

  const removeLoadCase = (loadCaseId: string) => {
    if (loadCases.length <= 1) {
      return;
    }
    const remaining = loadCases.filter((loadCase) => loadCase.id !== loadCaseId);
    const fallbackId = remaining[0]?.id ?? "LC-1";
    setLoadCases(remaining);
    setForces((current) =>
      current.map((force) =>
        force.loadCaseId === loadCaseId
          ? {
              ...force,
              loadCaseId: fallbackId
            }
          : force
      )
    );
    setSelectedLoadCaseId((current) => (current === loadCaseId ? fallbackId : current));
  };

  useEffect(() => {
    const validFixedIds = new Set(constraintGroups.fixedRegions.map((region) => region.id));
    setLoadCases((current) =>
      current.map((loadCase) => {
        const filtered = loadCase.fixedRegionIds.filter((regionId) => validFixedIds.has(regionId));
        return filtered.length === loadCase.fixedRegionIds.length
          ? loadCase
          : {
              ...loadCase,
              fixedRegionIds: filtered
            };
      })
    );
  }, [constraintGroups.fixedRegions]);

  const runStudy = async () => {
    if (isSubmittingStudy || jobId) {
      return;
    }

    if (!model) {
      setError("Upload a model before running a study.");
      return;
    }

    if (fixedCount === 0) {
      setError("Mark at least one fixed region before solve.");
      return;
    }

    const activeLoadCasesList = loadCases.filter((loadCase) => forces.some((force) => force.loadCaseId === loadCase.id));
    if (activeLoadCasesList.length === 0) {
      setError("Add at least one force to a load case before solve.");
      return;
    }

    const invalidLoadCase = activeLoadCasesList.find((loadCase) => loadCase.fixedRegionIds.length === 0);
    if (invalidLoadCase) {
      setError(`${invalidLoadCase.id} must reference at least one fixed region.`);
      return;
    }

    setError(null);
    setOutcomes([]);
    setSelectedOutcomeId(null);
    setSelectedOutcomeObject(null);
    setWorkerWarnings([]);
    setIsSubmittingStudy(true);
    setPaintLabel(null);
    setPlaceForceMode(false);
    setActiveStep("generate");

    try {
      const payload = buildSolvePayload({
        model,
        units: settings.units,
        faceLabels,
        forces,
        loadCases,
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

            // The worker solves from the transferred position buffer; the
            // encoded source model is only needed for API submissions, so
            // avoid cloning the (potentially large) base64 payload here.
            worker.postMessage(
              {
                type: "solve",
                payload: {
                  request: { ...payload, model: { ...payload.model, dataBase64: "" } },
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
        setShowOriginal(true);
        setShowOutcomeOverlay(true);
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
        setActiveStep("results");
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

  const selectedOutcome = outcomes.find((outcome) => outcome.id === selectedOutcomeId) ?? null;
  const statusTone: WorkspaceStatusTone = error ? "warning" : running ? "running" : "ready";
  const statusLabel = error ? "Needs attention" : running ? "Generating" : outcomes.length > 0 ? "Results ready" : "Ready";

  const activePanel = (() => {
    switch (activeStep) {
      case "model":
        return (
          <ModelPanel
            model={model}
            faceCount={faceLabels.length}
            units={settings.units}
            onUnitsChange={(units) => setSettings((curr) => ({ ...curr, units }))}
            onUploadFile={(file) => {
              void onUploadFile(file).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Could not parse uploaded model");
              });
            }}
            onLoadSample={() => {
              void loadSamplePart().catch((err: unknown) =>
                setError(err instanceof Error ? err.message : "Sample load failed")
              );
            }}
          />
        );
      case "preserve":
        return (
          <PreservePanel
            selecting={paintLabel === "preserved"}
            onToggleSelecting={() => {
              setPlaceForceMode(false);
              setPaintLabel((current) => (current === "preserved" ? null : "preserved"));
            }}
            preservedCount={preservedCount}
            preservedRegions={constraintGroups.preservedRegions}
          />
        );
      case "constraints":
        return (
          <ConstraintsPanel
            tool={paintLabel === "fixed" || paintLabel === "obstacle" || paintLabel === "design" ? paintLabel : null}
            onToolChange={(tool) => {
              setPlaceForceMode(false);
              setPaintLabel(tool);
            }}
            brushRadius={brushRadius}
            onBrushRadiusChange={setBrushRadius}
            fixedCount={fixedCount}
            obstacleCount={obstacleCount}
            fixedRegions={constraintGroups.fixedRegions}
          />
        );
      case "loads":
        return (
          <LoadsPanel
            loadCases={loadCases}
            selectedLoadCaseId={selectedLoadCaseId}
            forces={forces}
            selectedForceId={selectedForceId}
            fixedRegions={constraintGroups.fixedRegions}
            placeForceMode={placeForceMode}
            showAllForces={showAllForces}
            onSelectLoadCase={setSelectedLoadCaseId}
            onAddLoadCase={addLoadCase}
            onRemoveLoadCase={removeLoadCase}
            onUpdateLoadCase={updateLoadCase}
            onTogglePlaceForce={() => {
              setPaintLabel(null);
              setPlaceForceMode((current) => !current);
            }}
            onShowAllForcesChange={setShowAllForces}
            onSelectForce={setSelectedForceId}
            onUpdateForce={updateForce}
            onRemoveForce={removeForce}
          />
        );
      case "study":
        return (
          <StudyPanel
            settings={settings}
            onSettingsChange={(patch) => setSettings((curr) => ({ ...curr, ...patch }))}
            qualityProfile={qualityProfile}
            onQualityProfileChange={setQualityProfile}
            isBrowserSolver={isBrowserSolver}
          />
        );
      case "generate":
        return (
          <GeneratePanel
            checklist={checklist}
            canRun={canRun}
            running={running}
            jobStatus={jobStatus}
            warnings={workerWarnings}
            onRun={() => void runStudy()}
          />
        );
      case "results":
        return <ResultsPanel outcomes={outcomes} selectedOutcome={selectedOutcome} />;
    }
  })();

  return (
    <AppShell
      topBar={
        <TopBar
          modelName={model?.fileName ?? null}
          units={settings.units}
          running={running}
          canRun={canRun}
          missingRunItems={missingItems}
          onRun={() => void runStudy()}
        />
      }
      stepBar={
        <StepBar
          activeStep={activeStep}
          snapshot={snapshot}
          solverMode={SOLVER_MODE}
          units={settings.units}
          onSelect={handleStepSelect}
        />
      }
      viewer={
        <ViewerShell
          hasModel={Boolean(model)}
          paintLabel={paintLabel}
          placeForceMode={placeForceMode}
          toolbar={
            <ViewerToolbar
              showOriginal={showOriginal}
              showOutcomeOverlay={showOutcomeOverlay}
              wireframe={wireframe}
              hasOutcome={Boolean(selectedOutcomeObject)}
              onToggleOriginal={() => setShowOriginal((value) => !value)}
              onToggleOutcomeOverlay={() => setShowOutcomeOverlay((value) => !value)}
              onToggleWireframe={() => setWireframe((value) => !value)}
              onFit={() => setFitSignal((value) => value + 1)}
            />
          }
          legend={
            <SelectionLegend
              preservedCount={preservedCount}
              fixedCount={fixedCount}
              obstacleCount={obstacleCount}
              forceCount={forces.length}
            />
          }
        >
          <GenerativeDesignViewer
            geometry={model?.geometry ?? null}
            faceLabels={faceLabels}
            paintLabel={paintLabel}
            brushRadius={brushRadius}
            onPaintFaces={(indices, label) => {
              setFaceLabels((current) => applyFaceLabels(current, indices, label));
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
            fitSignal={fitSignal}
          />
          {error && (
            <div className="viewer-error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
        </ViewerShell>
      }
      contextPanel={
        <ContextPanel activeStep={activeStep} snapshot={snapshot} onStepSelect={handleStepSelect}>
          {activePanel}
        </ContextPanel>
      }
      outcomePanel={
        outcomes.length > 0 || running ? (
          <OutcomePanel
            outcomes={outcomes}
            selectedOutcomeId={selectedOutcomeId}
            jobStatus={running ? jobStatus : null}
            onSelectOutcome={(outcomeId) => {
              setSelectedOutcomeId(outcomeId);
              if (activeStep !== "results" && canNavigateToStep("results", snapshot)) {
                handleStepSelect("results");
              }
            }}
          />
        ) : null
      }
      statusBar={
        <StatusBar
          statusLabel={statusLabel}
          tone={statusTone}
          solverMode={SOLVER_MODE}
          modelName={model?.fileName ?? null}
          faceCount={faceLabels.length}
          preservedCount={preservedCount}
          fixedCount={fixedCount}
          outcomeCount={outcomes.length}
          studyId={studyId}
        />
      }
    />
  );
}
