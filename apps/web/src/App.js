import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OutcomeTiles } from "./components/OutcomeTiles";
import { ViewerCanvas } from "./components/ViewerCanvas";
import { parseGlbFromBase64, parseModelFile } from "./lib/modelParsers";
import { MATERIAL_OPTIONS } from "./materials";
import { applyFaceLabels, buildSolvePayload, getObstacleFaceIndices, getPreservedFaceIndices, initializeFaceLabels } from "./lib/studyState";
import "./styles.css";
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
const apiUrl = (path) => (API_BASE ? `${API_BASE}${path}` : path);
const SOLVER_MODE = import.meta.env.VITE_SOLVER_MODE === "api" ? "api" : "browser";
const STAGES = [
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
function stageLabel(stage) {
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
    const [model, setModel] = useState(null);
    const [faceLabels, setFaceLabels] = useState([]);
    const [paintLabel, setPaintLabel] = useState("preserved");
    const [brushRadius, setBrushRadius] = useState(0.06);
    const [placeForceMode, setPlaceForceMode] = useState(false);
    const [forces, setForces] = useState([]);
    const [selectedForceId, setSelectedForceId] = useState(null);
    const [settings, setSettings] = useState({
        units: "mm",
        material: "Aluminum 6061",
        targetSafetyFactor: 2,
        outcomeCount: 4,
        massReductionGoalPct: 45
    });
    const [qualityProfile, setQualityProfile] = useState("high-fidelity");
    const [studyId, setStudyId] = useState(null);
    const [jobId, setJobId] = useState(null);
    const [jobStatus, setJobStatus] = useState(null);
    const [error, setError] = useState(null);
    const [outcomes, setOutcomes] = useState([]);
    const [selectedOutcomeId, setSelectedOutcomeId] = useState(null);
    const [selectedOutcomeObject, setSelectedOutcomeObject] = useState(null);
    const [showOriginal, setShowOriginal] = useState(false);
    const [showOutcomeOverlay, setShowOutcomeOverlay] = useState(true);
    const [wireframe, setWireframe] = useState(false);
    const [isSubmittingStudy, setIsSubmittingStudy] = useState(false);
    const [workerWarnings, setWorkerWarnings] = useState([]);
    const workerRef = useRef(null);
    const selectedForce = useMemo(() => forces.find((force) => force.id === selectedForceId) ?? null, [forces, selectedForceId]);
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
                const payload = (await response.json());
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
            }
            catch (err) {
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
                    scene.position.set(model.solveToDisplayOffset[0], model.solveToDisplayOffset[1], model.solveToDisplayOffset[2]);
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
    const onUploadFile = async (file) => {
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
    const addForce = (point, normal) => {
        const id = `F-${forces.length + 1}`;
        const force = {
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
    const updateForce = (forceId, patch) => {
        setForces((current) => current.map((force) => {
            if (force.id !== forceId) {
                return force;
            }
            const next = { ...force, ...patch };
            next.label = `${next.id} (${next.magnitude} ${next.unit})`;
            return next;
        }));
    };
    const removeForce = (forceId) => {
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
                const transferablePositions = new Float32Array(solvePositionsAttr.array);
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
                const localResult = await new Promise((resolve, reject) => {
                    const cleanup = () => {
                        worker.terminate();
                        if (workerRef.current === worker) {
                            workerRef.current = null;
                        }
                    };
                    worker.onmessage = (event) => {
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
                    worker.postMessage({
                        type: "solve",
                        payload: {
                            request: payload,
                            geometry: { positions: transferablePositions },
                            qualityProfile
                        }
                    }, [transferablePositions.buffer]);
                });
                setOutcomes(localResult.outcomes);
                setSelectedOutcomeId(localResult.outcomes[0]?.id ?? null);
                setWorkerWarnings(localResult.warnings);
                setJobStatus((current) => current
                    ? {
                        ...current,
                        status: "succeeded",
                        stage: "complete",
                        progress: 1,
                        qualityProfile: localResult.qualityProfile,
                        warnings: localResult.warnings,
                        etaSeconds: 0
                    }
                    : current);
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
                    setError(`API endpoint rejected POST (${createStudyResponse.status}). This deployment is likely serving static assets only. Configure VITE_API_BASE to your backend URL. Current target: ${apiTarget}`);
                }
                else {
                    setError(`Study creation failed (${createStudyResponse.status}): ${text}`);
                }
                return;
            }
            const created = (await createStudyResponse.json());
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
            const accepted = (await runResponse.json());
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Unknown network error";
            if (!isBrowserSolver && message.toLowerCase().includes("failed to fetch")) {
                const apiTarget = API_BASE || "same origin (/api)";
                setError(`Cannot reach API at ${apiTarget}. Set VITE_API_BASE to your backend URL.`);
            }
            else {
                setError(`Failed to start study: ${message}`);
            }
        }
        finally {
            setIsSubmittingStudy(false);
        }
    };
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("aside", { className: "control-panel", children: [_jsxs("header", { children: [_jsx("h1", { children: "OpenTOS Generative Design" }), _jsx("p", { children: "Autodesk-inspired structural outcome studies for load-path-driven organic parts." })] }), _jsxs("section", { className: "panel-card", children: [_jsx("h2", { children: "1. Upload" }), _jsx("button", { type: "button", onClick: () => void loadSamplePart().catch((err) => setError(err instanceof Error ? err.message : "Sample load failed")), children: "Load Sample Connecting Rod" }), _jsx("input", { type: "file", accept: ".stl,.obj,.glb", onChange: (event) => {
                                    const file = event.target.files?.[0];
                                    if (!file) {
                                        return;
                                    }
                                    void onUploadFile(file).catch((err) => {
                                        setError(err instanceof Error ? err.message : "Could not parse uploaded model");
                                    });
                                } }), _jsxs("label", { children: ["Units", _jsxs("select", { value: settings.units, onChange: (event) => setSettings((curr) => ({ ...curr, units: event.target.value })), children: [_jsx("option", { value: "mm", children: "mm" }), _jsx("option", { value: "in", children: "in" }), _jsx("option", { value: "m", children: "m" })] })] }), model && _jsxs("p", { className: "small-note", children: ["Loaded: ", model.fileName] })] }), _jsxs("section", { className: "panel-card", children: [_jsx("h2", { children: "2. Preserve Geometry" }), _jsxs("div", { className: "inline-buttons", children: [_jsx("button", { type: "button", className: paintLabel === "preserved" ? "is-active" : "", onClick: () => {
                                            setPaintLabel("preserved");
                                            setPlaceForceMode(false);
                                        }, children: "Select Preserved Surface" }), _jsx("button", { type: "button", className: paintLabel === "design" ? "is-active" : "", onClick: () => {
                                            setPaintLabel("design");
                                            setPlaceForceMode(false);
                                        }, children: "Paint Design" }), _jsx("button", { type: "button", className: paintLabel === "obstacle" ? "is-active" : "", onClick: () => {
                                            setPaintLabel("obstacle");
                                            setPlaceForceMode(false);
                                        }, children: "Paint Obstacle" })] }), _jsxs("label", { children: ["Brush Radius", _jsx("input", { type: "range", min: 0.02, max: 0.2, step: 0.01, value: brushRadius, onChange: (event) => setBrushRadius(Number(event.target.value)) })] }), _jsx("p", { className: "small-note", children: "Preserved mode: left-click to keep geometry, right-click to clear it back to design." }), _jsxs("p", { className: "small-note", children: ["Preserved faces: ", preservedCount] }), _jsxs("p", { className: "small-note", children: ["Obstacle faces: ", obstacleCount] })] }), _jsxs("section", { className: "panel-card", children: [_jsx("h2", { children: "3. Loads" }), _jsx("button", { type: "button", className: placeForceMode ? "is-active" : "", onClick: () => {
                                    setPlaceForceMode((current) => !current);
                                    setPaintLabel(null);
                                }, children: placeForceMode ? "Click Surface to Place..." : "Add Force" }), _jsx("div", { className: "force-list", children: forces.map((force) => (_jsx("button", { type: "button", className: `force-chip ${selectedForceId === force.id ? "is-active" : ""}`, onClick: () => setSelectedForceId(force.id), children: force.label }, force.id))) }), selectedForce && (_jsxs("div", { className: "force-editor", children: [_jsxs("label", { children: ["Magnitude", _jsx("input", { type: "number", min: 0.1, step: 0.1, value: selectedForce.magnitude, onChange: (event) => updateForce(selectedForce.id, { magnitude: Number(event.target.value) }) })] }), _jsxs("label", { children: ["Unit", _jsxs("select", { value: selectedForce.unit, onChange: (event) => updateForce(selectedForce.id, { unit: event.target.value }), children: [_jsx("option", { value: "lb", children: "lb" }), _jsx("option", { value: "N", children: "N" })] })] }), _jsxs("label", { children: ["Direction X", _jsx("input", { type: "number", step: 0.1, value: selectedForce.direction[0], onChange: (event) => updateForce(selectedForce.id, {
                                                    direction: [
                                                        Number(event.target.value),
                                                        selectedForce.direction[1],
                                                        selectedForce.direction[2]
                                                    ]
                                                }) })] }), _jsxs("label", { children: ["Direction Y", _jsx("input", { type: "number", step: 0.1, value: selectedForce.direction[1], onChange: (event) => updateForce(selectedForce.id, {
                                                    direction: [
                                                        selectedForce.direction[0],
                                                        Number(event.target.value),
                                                        selectedForce.direction[2]
                                                    ]
                                                }) })] }), _jsxs("label", { children: ["Direction Z", _jsx("input", { type: "number", step: 0.1, value: selectedForce.direction[2], onChange: (event) => updateForce(selectedForce.id, {
                                                    direction: [
                                                        selectedForce.direction[0],
                                                        selectedForce.direction[1],
                                                        Number(event.target.value)
                                                    ]
                                                }) })] }), _jsxs("div", { className: "inline-buttons", children: [_jsx("button", { type: "button", onClick: () => updateForce(selectedForce.id, { direction: selectedForce.normal }), children: "Align to Face Normal" }), _jsx("button", { type: "button", onClick: () => removeForce(selectedForce.id), children: "Remove" })] })] }))] }), _jsxs("section", { className: "panel-card", children: [_jsx("h2", { children: "4. Study Setup" }), _jsxs("label", { children: ["Material", _jsx("select", { value: settings.material, onChange: (event) => setSettings((curr) => ({
                                            ...curr,
                                            material: event.target.value
                                        })), children: MATERIAL_OPTIONS.map((materialName) => (_jsx("option", { value: materialName, children: materialName }, materialName))) })] }), _jsxs("label", { children: ["Safety Factor", _jsx("input", { type: "number", min: 1, max: 5, step: 0.1, value: settings.targetSafetyFactor, onChange: (event) => setSettings((curr) => ({ ...curr, targetSafetyFactor: Number(event.target.value) })) })] }), _jsxs("label", { children: ["Mass Reduction Goal (%)", _jsx("input", { type: "number", min: 5, max: 80, step: 1, value: settings.massReductionGoalPct, onChange: (event) => setSettings((curr) => ({ ...curr, massReductionGoalPct: Number(event.target.value) })) })] }), _jsxs("label", { children: ["Outcomes", _jsx("input", { type: "number", min: 2, max: 12, step: 1, value: settings.outcomeCount, onChange: (event) => setSettings((curr) => ({ ...curr, outcomeCount: Number(event.target.value) })) })] }), isBrowserSolver && (_jsxs("label", { children: ["Browser Quality", _jsxs("select", { value: qualityProfile, onChange: (event) => setQualityProfile(event.target.value), children: [_jsx("option", { value: "high-fidelity", children: "High Fidelity" }), _jsx("option", { value: "balanced", children: "Balanced" }), _jsx("option", { value: "fast-preview", children: "Fast Preview" })] })] })), _jsx("button", { type: "button", className: "run-button", disabled: isSubmittingStudy || Boolean(jobId), onClick: () => void runStudy(), children: isSubmittingStudy || jobId ? "Starting Study..." : "Run Generative Study" }), _jsx("p", { className: "small-note run-hint", children: "Required: model upload, at least 1 preserved face, and at least 1 force." }), _jsxs("p", { className: "small-note run-hint", children: ["Solver mode: ", isBrowserSolver ? "Browser (local compute)" : "API (remote compute)"] }), jobStatus?.qualityProfile && (_jsxs("p", { className: "small-note run-hint", children: ["Active quality: ", jobStatus.qualityProfile] })), jobStatus?.etaSeconds != null && jobStatus.status === "running" && (_jsxs("p", { className: "small-note run-hint", children: ["ETA: ~", Math.max(0, jobStatus.etaSeconds), "s"] })), workerWarnings.length > 0 && (_jsx("div", { className: "panel-warning", children: workerWarnings.map((warning, idx) => (_jsx("p", { children: warning }, `${idx}-${warning}`))) })), error && _jsx("p", { className: "panel-error", children: error })] })] }), _jsxs("main", { className: "workspace", children: [_jsxs("section", { className: "viewer-panel", children: [_jsxs("div", { className: "viewer-toolbar", children: [_jsxs("div", { className: "inline-buttons", children: [_jsx("button", { type: "button", className: showOriginal ? "is-active" : "", onClick: () => setShowOriginal((v) => !v), children: "Original" }), _jsx("button", { type: "button", className: showOutcomeOverlay ? "is-active" : "", onClick: () => setShowOutcomeOverlay((v) => !v), children: "Generated" }), _jsx("button", { type: "button", className: wireframe ? "is-active" : "", onClick: () => setWireframe((v) => !v), children: "Wireframe" })] }), jobStatus && (_jsxs("div", { className: "progress-wrap", children: [_jsxs("div", { className: "progress-meta", children: [_jsx("span", { children: stageLabel(jobStatus.stage) }), _jsxs("strong", { children: [Math.round(jobStatus.progress * 100), "%"] })] }), _jsx("progress", { max: 1, value: jobStatus.progress }), _jsx("div", { className: "stage-track", children: STAGES.map((stage) => (_jsx("span", { className: STAGES.indexOf(stage) <=
                                                        Math.max(0, STAGES.indexOf(jobStatus.stage === "failed" ? "complete" : jobStatus.stage))
                                                        ? "is-hit"
                                                        : "", children: stageLabel(stage) }, stage))) })] }))] }), _jsx(ViewerCanvas, { geometry: model?.geometry ?? null, faceLabels: faceLabels, paintLabel: paintLabel, brushRadius: brushRadius, onPaintFaces: (indices, label) => {
                                    setFaceLabels((current) => applyFaceLabels(current, indices, label));
                                }, placeForceMode: placeForceMode, onPlaceForce: addForce, forces: forces, selectedForceId: selectedForceId, onSelectForce: setSelectedForceId, outcomeObject: selectedOutcomeObject, showOriginal: showOriginal, showOutcomeOverlay: showOutcomeOverlay, wireframe: wireframe })] }), _jsxs("section", { className: "outcomes-panel", children: [_jsxs("div", { className: "outcomes-header", children: [_jsx("h2", { children: "Outcome View" }), _jsxs("p", { children: [outcomes.length, " outcomes generated"] })] }), outcomes.length > 0 ? (_jsx(OutcomeTiles, { outcomes: outcomes, selectedOutcomeId: selectedOutcomeId, onSelectOutcome: setSelectedOutcomeId })) : (_jsx("p", { className: "empty-state", children: "Run a study to see Autodesk-style structural variants side-by-side." }))] }), error && _jsx("div", { className: "error-banner", children: error })] })] }));
}
