import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Download, FileText, Info, Sparkles } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import * as THREE from "three";

import { apiUrl } from "../../app/api";
import { useStudyStore, type MetricMode } from "../../app/store";
import { TradeoffPlot } from "../../components/TradeoffPlot";
import { ViewerCanvas } from "../../components/ViewerCanvas";
import { parseGlbFromBase64 } from "../../lib/modelParsers";

function number(value: number, digits = 2): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

export function formatMass(kilograms: number): string {
  if (kilograms >= 1) return `${number(kilograms, 2)} kg`;
  if (kilograms >= 0.001) return `${number(kilograms * 1000, 2)} g`;
  return `${number(kilograms * 1_000_000, 2)} mg`;
}

function useOutcomeObject(base64?: string, offset?: [number, number, number]) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    if (!base64) {
      setObject(null);
      return;
    }
    let active = true;
    parseGlbFromBase64(base64).then((scene) => {
      if (!active) return;
      if (offset) scene.position.set(...offset);
      setObject(scene);
    }).catch(() => active && setObject(null));
    return () => { active = false; };
  }, [base64, offset?.join(":")]);
  return object;
}

function OutcomeTable() {
  const { outcomes, selectedOutcomeId, set } = useStudyStore();
  return (
    <div className="outcome-table-wrap">
      <table className="outcome-table">
        <thead><tr><th>Outcome</th><th>Mass</th><th>Reduction</th><th>Safety</th></tr></thead>
        <tbody>{outcomes.map((outcome) => (
          <tr key={outcome.id} className={outcome.id === selectedOutcomeId ? "is-selected" : ""}>
            <th scope="row"><button type="button" onClick={() => set({ selectedOutcomeId: outcome.id })}>{outcome.id}<span>Preview</span></button></th>
            <td>{formatMass(outcome.metrics.mass)}</td>
            <td>{number(outcome.metrics.massReductionPct, 1)}%</td>
            <td>{number(outcome.metrics.safetyIndexProxy, 2)}×</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function CopilotPanel({ projectId, selectedOutcomeId }: { projectId: string; selectedOutcomeId: string | null }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!message.trim() || busy) return;
    if (projectId === "local") {
      setReply("Connect the API-backed workspace to use the configured Study Copilot. Preview metrics here are not verification evidence.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(apiUrl(`/api/v3/projects/${projectId}/copilot`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, outcomeIds: selectedOutcomeId ? [selectedOutcomeId] : [] })
      });
      const payload = await response.json() as { message?: string; detail?: string };
      setReply(payload.message ?? payload.detail ?? `Copilot request failed (${response.status}).`);
    } catch (error) {
      setReply(error instanceof Error ? error.message : "Copilot request failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="disclosure-card">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}><span><Sparkles size={15} />Study Copilot</span><ChevronDown size={16} /></button>
    {open && <div className="copilot-body"><p>Ask about the selected outcome, checks, or next verification step.</p><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What should I verify before choosing this outcome?" /><button className="primary-button" type="button" disabled={busy || !message.trim()} onClick={() => void submit()}>{busy ? "Thinking…" : "Ask Copilot"}</button>{reply && <div className="copilot-reply">{reply}</div>}</div>}
  </section>;
}

export function ResultsWorkspace() {
  const { projectId = "local" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useStudyStore();
  const { model, outcomes, selectedOutcomeId, showOriginal, showOutcome, wireframe, metricMode, settings, warnings } = state;
  const selected = outcomes.find((outcome) => outcome.id === selectedOutcomeId) ?? outcomes[0] ?? null;
  const outcomeObject = useOutcomeObject(selected?.optimizedModel.dataBase64, model?.solveToDisplayOffset);

  useEffect(() => {
    const outcome = searchParams.get("outcome");
    const metric = searchParams.get("metric") as MetricMode | null;
    const validMetric = metric === "stress" || metric === "displacement" || metric === "outcome";
    state.set({
      selectedOutcomeId: outcomes.some((item) => item.id === outcome) ? outcome : selectedOutcomeId ?? outcomes[0]?.id ?? null,
      metricMode: validMetric ? metric : metricMode
    });
    // URL state is initialized when the route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("view", "outcome");
    if (selectedOutcomeId) next.set("outcome", selectedOutcomeId);
    next.set("metric", metricMode);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [selectedOutcomeId, metricMode, searchParams, setSearchParams]);

  if (!selected) {
    return <main className="results-empty"><div><Info size={34} /><h1>No outcomes yet</h1><p>Complete the study setup and run the preview engine to compare outcomes.</p><Link className="primary-button" to={`/projects/${projectId}/setup`}>Return to setup</Link></div></main>;
  }

  const checks = [
    { label: "Mass reduction goal", pass: selected.metrics.massReductionPct >= settings.massReductionGoalPct, actual: `${number(selected.metrics.massReductionPct, 1)}%`, target: `≥ ${settings.massReductionGoalPct}%` },
    { label: "Safety factor proxy", pass: selected.metrics.safetyIndexProxy >= settings.targetSafetyFactor, actual: `${number(selected.metrics.safetyIndexProxy, 2)}×`, target: `≥ ${settings.targetSafetyFactor.toFixed(1)}×` },
    { label: "Linear-static verification", pass: false, warning: true, actual: "Not run", target: "Required" }
  ];

  return <main className="results-workspace">
    <aside className="outcomes-rail">
      <div className="rail-heading"><span>STUDY RESULTS</span><strong>{outcomes.length} preview outcomes</strong></div>
      <OutcomeTable />
      <div className="preview-notice"><AlertTriangle size={15} /><p><strong>Preview metrics</strong>Values guide comparison but are not engineering verification.</p></div>
    </aside>

    <section className="results-main">
      <div className="result-viewer-header">
        <div><span>SELECTED OUTCOME</span><h1>{selected.id}</h1></div>
        <div className="segmented view-modes">
          <button type="button" className={showOutcome && !showOriginal ? "is-active" : ""} onClick={() => state.set({ showOutcome: true, showOriginal: false })}>Outcome</button>
          <button type="button" className={showOriginal && !showOutcome ? "is-active" : ""} onClick={() => state.set({ showOriginal: true, showOutcome: false })}>Original</button>
          <button type="button" className={showOriginal && showOutcome ? "is-active" : ""} onClick={() => state.set({ showOriginal: true, showOutcome: true })}>Overlay</button>
        </div>
      </div>
      <div className="result-viewer">
        <ViewerCanvas
          geometry={model?.geometry ?? null}
          faceLabels={model ? state.faceLabels : []}
          paintLabel={null}
          brushRadius={state.brushRadius}
          onPaintFaces={() => undefined}
          placeForceMode={false}
          onPlaceForce={() => undefined}
          forces={state.forces}
          selectedForceId={null}
          onSelectForce={() => undefined}
          outcomeObject={outcomeObject}
          showOriginal={showOriginal}
          showOutcomeOverlay={showOutcome}
          wireframe={wireframe}
        />
        <div className="viewer-metrics">
          <span><small>Mass</small><strong>{formatMass(selected.metrics.mass)}</strong></span>
          <span><small>Reduction</small><strong>{number(selected.metrics.massReductionPct, 1)}%</strong></span>
          <span><small>Safety proxy</small><strong>{number(selected.metrics.safetyIndexProxy, 2)}×</strong></span>
        </div>
        <button className="wireframe-toggle" type="button" aria-pressed={wireframe} onClick={() => state.set({ wireframe: !wireframe })}>Wireframe {wireframe ? "on" : "off"}</button>
      </div>
      <div className="metric-mode-control" aria-label="Result metric">
        {(["outcome", "stress", "displacement"] as MetricMode[]).map((mode) => <button key={mode} type="button" className={metricMode === mode ? "is-active" : ""} onClick={() => state.set({ metricMode: mode })}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
        {metricMode !== "outcome" && <span>Proxy field visualization is not available in the current preview engine.</span>}
      </div>
      <TradeoffPlot outcomes={outcomes} selectedOutcomeId={selected.id} targetSafetyFactor={settings.targetSafetyFactor} onSelect={(id) => state.set({ selectedOutcomeId: id })} />
    </section>

    <aside className="results-inspector">
      <section className="result-summary"><span className="preview-pill">PREVIEW</span><h2>{selected.id}</h2><p>Ranked candidate from the local voxel approximation.</p></section>
      <section className="inspector-section"><h2>Constraint checks</h2><ul className="constraint-checks">{checks.map((check) => <li key={check.label} className={check.pass ? "pass" : check.warning ? "warning" : "fail"}>{check.pass ? <Check size={15} /> : <AlertTriangle size={15} />}<div><strong>{check.label}</strong><span>{check.actual} <small>{check.target}</small></span></div></li>)}</ul></section>
      <section className="inspector-section"><h2>Solver provenance</h2><dl className="property-table"><div><dt>Engine</dt><dd>{state.jobStatus?.solverVersion ?? "Local preview"}</dd></div><div><dt>Method</dt><dd>Voxel approximation</dd></div><div><dt>Quality</dt><dd>{state.jobStatus?.qualityProfile ?? state.qualityProfile}</dd></div><div><dt>Verification</dt><dd>Not run</dd></div></dl></section>
      {warnings.length > 0 && <section className="inspector-section"><h2>Run notes</h2><ul className="warning-list">{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></section>}
      <CopilotPanel projectId={projectId} selectedOutcomeId={selected.id} />
      <div className="export-bar"><a className="secondary-button" href={`data:model/gltf-binary;base64,${selected.optimizedModel.dataBase64}`} download={`${selected.id}.glb`}><Download size={15} />Download GLB</a><button type="button" className="secondary-button" disabled title="Report export will be enabled after verified solver results are available."><FileText size={15} />Export report</button></div>
    </aside>
  </main>;
}
