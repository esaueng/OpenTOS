import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OutcomeV2 } from "@contracts/index";

import { parseGlbFromBase64 } from "../lib/modelParsers";

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
        material.color = new THREE.Color("#22c55e");
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
    <div className="outcome-thumb">
      <Canvas camera={{ position: [1.2, 1.1, 1.2], fov: 35 }} dpr={1} gl={{ antialias: false, powerPreference: "low-power" }}>
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
  return value.toFixed(2);
}

interface OutcomeCardProps {
  outcome: OutcomeV2;
  rank: number;
  selected: boolean;
  onSelect: (outcomeId: string) => void;
}

export function OutcomeCard({ outcome, rank, selected, onSelect }: OutcomeCardProps) {
  return (
    <button
      type="button"
      className={`outcome-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(outcome.id)}
      aria-pressed={selected}
    >
      <div className="outcome-card-head">
        <strong className="mono">{outcome.id}</strong>
        <span className="rank-pill mono">#{rank}</span>
      </div>
      <Thumbnail base64={outcome.optimizedModel.dataBase64} />
      <dl className="outcome-metrics mono">
        <div><dt>mass Δ</dt><dd>{formatMetric(outcome.metrics.massReductionPct)}%</dd></div>
        <div><dt>mass</dt><dd>{formatMetric(outcome.metrics.mass)}</dd></div>
        <div><dt>stress</dt><dd>{formatMetric(outcome.metrics.stressProxy)}</dd></div>
        <div><dt>safety</dt><dd>{formatMetric(outcome.metrics.safetyIndexProxy)}</dd></div>
      </dl>
    </button>
  );
}
