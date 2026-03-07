import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { parseGlbFromBase64 } from "../lib/modelParsers";
function Thumbnail({ base64 }) {
    const [object, setObject] = useState(null);
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
            }
            else {
                material.color = new THREE.Color("#2e3a46");
                material.opacity = 1;
                material.metalness = 0.5;
                material.roughness = 0.44;
                material.emissive = new THREE.Color("#10161f");
                material.emissiveIntensity = 0.08;
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
    return (_jsx("div", { className: "thumbnail-canvas", children: _jsxs(Canvas, { camera: { position: [1.2, 1.1, 1.2], fov: 35 }, children: [_jsx("ambientLight", { intensity: 0.75 }), _jsx("directionalLight", { position: [2, 3, 2], intensity: 1.0 }), previewObject && _jsx("primitive", { object: previewObject }), _jsx(OrbitControls, { enablePan: false, enableZoom: false, autoRotate: true, autoRotateSpeed: 0.75 })] }) }));
}
function formatMetric(value) {
    if (Math.abs(value) >= 1000) {
        return value.toFixed(0);
    }
    if (Math.abs(value) >= 100) {
        return value.toFixed(1);
    }
    return value.toFixed(3);
}
export function OutcomeTiles({ outcomes, selectedOutcomeId, onSelectOutcome }) {
    const sorted = useMemo(() => [...outcomes].sort((a, b) => {
        const aScore = typeof a.variantParams?.rankScore === "number" ? Number(a.variantParams.rankScore) : Number.POSITIVE_INFINITY;
        const bScore = typeof b.variantParams?.rankScore === "number" ? Number(b.variantParams.rankScore) : Number.POSITIVE_INFINITY;
        if (aScore !== bScore) {
            return aScore - bScore;
        }
        return a.id.localeCompare(b.id);
    }), [outcomes]);
    return (_jsx("div", { className: "outcome-grid", children: sorted.map((outcome) => {
            const selected = selectedOutcomeId === outcome.id;
            return (_jsxs("button", { className: `outcome-tile ${selected ? "is-selected" : ""}`, onClick: () => onSelectOutcome(outcome.id), type: "button", children: [_jsxs("div", { className: "tile-header", children: [_jsx("strong", { children: outcome.id }), _jsx("span", { children: selected ? "Focused" : "Select" })] }), _jsx(Thumbnail, { base64: outcome.optimizedModel.dataBase64 }), _jsxs("div", { className: "tile-metrics", children: [_jsxs("span", { children: ["Volume: ", formatMetric(outcome.metrics.volume)] }), _jsxs("span", { children: ["Mass: ", formatMetric(outcome.metrics.mass)] }), _jsxs("span", { children: ["Mass \u0394: ", formatMetric(outcome.metrics.massReductionPct), "%"] }), _jsxs("span", { children: ["Stress: ", formatMetric(outcome.metrics.stressProxy)] }), _jsxs("span", { children: ["Disp: ", formatMetric(outcome.metrics.displacementProxy)] }), _jsxs("span", { children: ["Safety: ", formatMetric(outcome.metrics.safetyIndexProxy)] })] })] }, outcome.id));
        }) }));
}
