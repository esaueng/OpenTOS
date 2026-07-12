import { useCallback, useEffect, useRef } from "react";
import type { OutcomeV2 } from "@contracts/index";
import * as THREE from "three";

import { buildSolvePayload } from "../../lib/studyState";
import type { BrowserQualityProfile, JobStatus } from "../../types";
import { useStudyStore } from "../../app/store";

type WorkerMessage =
  | { type: "progress"; stage: JobStatus["stage"]; progress: number; status: JobStatus["status"]; qualityProfile: BrowserQualityProfile; warnings: string[]; etaSeconds?: number }
  | { type: "result"; outcomes: OutcomeV2[]; qualityProfile: BrowserQualityProfile; warnings: string[] }
  | { type: "error"; error: string };

export function usePreviewSolver() {
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  return useCallback(async () => {
    const state = useStudyStore.getState();
    const { model, settings, faceLabels, forces, loadCases, qualityProfile } = state;
    if (!model) throw new Error("Load a model before running the study.");

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
    const positionAttribute = model.solveGeometry.getAttribute("position");
    if (!(positionAttribute instanceof THREE.BufferAttribute) || positionAttribute.itemSize !== 3) {
      throw new Error("The model has invalid solve geometry.");
    }

    workerRef.current?.terminate();
    const worker = new Worker(new URL("../../workers/solverWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const positions = new Float32Array(positionAttribute.array as Float32Array);
    state.set({
      isRunning: true,
      error: null,
      warnings: [],
      outcomes: [],
      selectedOutcomeId: null,
      paintLabel: null,
      placeForceMode: false,
      jobStatus: {
        jobId: "browser-preview",
        studyId: "browser-preview",
        status: "queued",
        stage: "queued",
        progress: 0,
        solverVersion: "opentos-browser-preview",
        qualityProfile,
        warnings: []
      }
    });

    try {
      const result = await new Promise<{ outcomes: OutcomeV2[]; warnings: string[]; qualityProfile: BrowserQualityProfile }>((resolve, reject) => {
        const close = () => {
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        };
        worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
          const message = event.data;
          if (message.type === "progress") {
            useStudyStore.getState().set({
              warnings: message.warnings,
              jobStatus: {
                jobId: "browser-preview",
                studyId: "browser-preview",
                status: message.status,
                stage: message.stage,
                progress: message.progress,
                etaSeconds: message.etaSeconds,
                solverVersion: "opentos-browser-preview",
                qualityProfile: message.qualityProfile,
                warnings: message.warnings
              }
            });
          } else if (message.type === "result") {
            close();
            resolve(message);
          } else {
            close();
            reject(new Error(message.error || "Preview solve failed."));
          }
        };
        worker.onerror = (event) => {
          close();
          reject(new Error(event.message || "Preview worker crashed."));
        };
        worker.postMessage(
          {
            type: "solve",
            payload: {
              request: { ...payload, model: { ...payload.model, dataBase64: "" } },
              geometry: { positions },
              qualityProfile
            }
          },
          [positions.buffer]
        );
      });

      useStudyStore.getState().set({
        isRunning: false,
        outcomes: result.outcomes,
        selectedOutcomeId: result.outcomes[0]?.id ?? null,
        warnings: [
          "Preview result only — stress, displacement, and safety values are solver proxies and require verification.",
          ...result.warnings
        ],
        jobStatus: {
          jobId: "browser-preview",
          studyId: "browser-preview",
          status: "succeeded",
          stage: "complete",
          progress: 1,
          solverVersion: "opentos-browser-preview",
          qualityProfile: result.qualityProfile,
          warnings: result.warnings,
          etaSeconds: 0
        }
      });
      return result.outcomes;
    } catch (error) {
      useStudyStore.getState().set({
        isRunning: false,
        error: error instanceof Error ? error.message : "Preview solve failed.",
        jobStatus: null
      });
      throw error;
    }
  }, []);
}
