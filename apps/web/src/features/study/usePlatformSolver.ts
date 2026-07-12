import { useCallback } from "react";
import type { OutcomeV2, OutcomeV3, SolverRunV3 } from "@contracts/index";

import { apiUrl } from "../../app/api";
import { useStudyStore } from "../../app/store";
import { buildSolvePayload } from "../../lib/studyState";

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
  }
  return btoa(binary);
}

async function expectJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `API request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

async function hydrateOutcome(outcome: OutcomeV3): Promise<OutcomeV2> {
  const response = await fetch(apiUrl(outcome.model.downloadUrl));
  if (!response.ok) throw new Error(`Unable to download ${outcome.id} (${response.status}).`);
  return {
    id: outcome.id,
    optimizedModel: { format: "glb", dataBase64: bytesToBase64(new Uint8Array(await response.arrayBuffer())) },
    metrics: outcome.metrics,
    variantParams: { rank: outcome.rank, verificationStatus: outcome.status },
    warnings: outcome.warnings
  };
}

export function usePlatformSolver(projectId: string) {
  return useCallback(async () => {
    const state = useStudyStore.getState();
    const { model, settings, faceLabels, forces, loadCases, qualityProfile } = state;
    if (!model) throw new Error("Load a model before running the study.");
    if (!projectId || projectId === "local") throw new Error("Create an API-backed project before starting a durable run.");

    state.set({ isRunning: true, error: null, outcomes: [], warnings: [], selectedOutcomeId: null });
    try {
      let modelRevisionId = state.platformModelRevisionId;
      if (!modelRevisionId) {
        const form = new FormData();
        form.append("units", settings.units);
        form.append("file", base64ToBlob(model.dataBase64, "application/octet-stream"), model.fileName);
        const revision = await expectJson<{ id: string }>(await fetch(apiUrl(`/api/v3/projects/${projectId}/models`), { method: "POST", body: form }));
        modelRevisionId = revision.id;
        state.set({ platformModelRevisionId: revision.id });
      }

      const payload = buildSolvePayload({ model, units: settings.units, faceLabels, forces, loadCases, material: settings.material, targetSafetyFactor: settings.targetSafetyFactor, outcomeCount: settings.outcomeCount, massReductionGoalPct: settings.massReductionGoalPct });
      const study = await expectJson<{ id: string }>(await fetch(apiUrl(`/api/v3/projects/${projectId}/studies`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelRevisionId,
          name: state.projectName,
          units: settings.units,
          material: settings.material,
          constraints: {
            designRegion: payload.designRegion,
            preservedRegions: payload.preservedRegions,
            obstacleRegions: payload.obstacleRegions
          },
          loadCases: payload.loadCases,
          targets: payload.targets,
          manufacturing: { minimumThickness: settings.units === "mm" ? 2 : 0.08, symmetry: "none", process: "unconstrained" }
        })
      }));
      state.set({ platformStudyId: study.id });

      let run = await expectJson<SolverRunV3>(await fetch(apiUrl(`/api/v3/projects/${projectId}/studies/${study.id}/runs`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qualityProfile, seed: 0, verification: "preview" })
      }));
      state.set({ platformRunId: run.id });

      while (run.state === "queued" || run.state === "running") {
        state.set({
          jobStatus: {
            jobId: run.id,
            studyId: study.id,
            status: run.state,
            stage: run.stage,
            progress: run.progress,
            etaSeconds: run.etaSeconds,
            warnings: run.warnings,
            solverVersion: "opentos-platform-v3",
            qualityProfile
          }
        });
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        run = await expectJson<SolverRunV3>(await fetch(apiUrl(`/api/v3/runs/${run.id}`)));
      }
      if (run.state !== "succeeded") throw new Error(run.error || `Run ended with state ${run.state}.`);

      const outcomes = await Promise.all(run.outcomes.map(hydrateOutcome));
      state.set({
        isRunning: false,
        outcomes,
        selectedOutcomeId: outcomes[0]?.id ?? null,
        warnings: run.warnings,
        jobStatus: {
          jobId: run.id,
          studyId: study.id,
          status: "succeeded",
          stage: "complete",
          progress: 1,
          warnings: run.warnings,
          solverVersion: run.outcomes[0]?.provenance.solver ?? "opentos-platform-v3",
          qualityProfile
        }
      });
      return outcomes;
    } catch (error) {
      state.set({ isRunning: false, error: error instanceof Error ? error.message : "Platform run failed." });
      throw error;
    }
  }, [projectId]);
}
