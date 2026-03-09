import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OutcomeV2 } from "@contracts/index";

import { parseGlbFromBase64 } from "../lib/modelParsers";

interface OutcomeTilesProps {
  outcomes: OutcomeV2[];
  selectedOutcomeId: string | null;
  onSelectOutcome: (outcomeId: string) => void;
}

function Thumbnail({ base64 }: { base64: string }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const previewObject = useMemo(() => {
    if (!object) {
      return null;
    }
    const clone = object.clone(true);
    clone.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || !node.material) {
        return;
      }
      const source = Array.isArray(node.material) ? node.material[0] : node.material;
      const material = source.clone();
      material.wireframe = false;
      material.transparent = false;
      if (node.name === "preserved") {
        material.color = new THREE.Color("#35d07f");
        material.opacity = 1;
        material.metalness = 0.08;
        material.roughness = 0.72;
      } else {
        material.color = new THREE.Color("#b6bac2");
        material.opacity = 1;
        material.metalness = 0.72;
        material.roughness = 0.34;
        material.emissive = new THREE.Color("#141820");
        material.emissiveIntensity = 0.03;
      }
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
      node.material = material;
    });
    return clone;
  }, [object]);

  useEffect(() => {
    let active = true;
    parseGlbFromBase64(base64)
      .then((scene) => {
        if (active) {
          setObject(scene);
        }
      })
      .catch(() => {
        if (active) {
          setObject(null);
        }
      });

    return () => {
      active = false;
    };
  }, [base64]);

  return (
    <div className="thumbnail-canvas">
      <Canvas camera={{ position: [1.2, 1.1, 1.2], fov: 35 }}>
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 3, 2]} intensity={1.0} />
        {previewObject && <primitive object={previewObject} />}
        <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={0.75} />
      </Canvas>
    </div>
  );
}

function formatMetric(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }
  return value.toFixed(3);
}

export function OutcomeTiles({ outcomes, selectedOutcomeId, onSelectOutcome }: OutcomeTilesProps) {
  const sorted = useMemo(
    () =>
      [...outcomes].sort((a, b) => {
        const aScore = typeof a.variantParams?.rankScore === "number" ? Number(a.variantParams.rankScore) : Number.POSITIVE_INFINITY;
        const bScore = typeof b.variantParams?.rankScore === "number" ? Number(b.variantParams.rankScore) : Number.POSITIVE_INFINITY;
        if (aScore !== bScore) {
          return aScore - bScore;
        }
        return a.id.localeCompare(b.id);
      }),
    [outcomes]
  );

  return (
    <div className="outcome-grid">
      {sorted.map((outcome) => {
        const selected = selectedOutcomeId === outcome.id;
        return (
          <button
            key={outcome.id}
            className={`outcome-tile ${selected ? "is-selected" : ""}`}
            onClick={() => onSelectOutcome(outcome.id)}
            type="button"
          >
            <div className="tile-header">
              <strong>{outcome.id}</strong>
              <span>{selected ? "Focused" : "Select"}</span>
            </div>
            <Thumbnail base64={outcome.optimizedModel.dataBase64} />
            <div className="tile-metrics">
              <span>Volume: {formatMetric(outcome.metrics.volume)}</span>
              <span>Mass: {formatMetric(outcome.metrics.mass)}</span>
              <span>Mass Δ: {formatMetric(outcome.metrics.massReductionPct)}%</span>
              <span>Stress: {formatMetric(outcome.metrics.stressProxy)}</span>
              <span>Disp: {formatMetric(outcome.metrics.displacementProxy)}</span>
              <span>Safety: {formatMetric(outcome.metrics.safetyIndexProxy)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
