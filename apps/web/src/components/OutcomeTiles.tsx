import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Outcome } from "@contracts/index";

import { parseGlbFromBase64 } from "../lib/modelParsers";

interface OutcomeTilesProps {
  outcomes: Outcome[];
  selectedOutcomeId: string | null;
  onSelectOutcome: (outcomeId: string) => void;
}

function Thumbnail({ base64 }: { base64: string }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);

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
        {object && <primitive object={object.clone(true)} />}
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
  const sorted = useMemo(() => [...outcomes].sort((a, b) => a.id.localeCompare(b.id)), [outcomes]);

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
              <span>Stress: {formatMetric(outcome.metrics.stressProxy)}</span>
              <span>Disp: {formatMetric(outcome.metrics.displacementProxy)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
