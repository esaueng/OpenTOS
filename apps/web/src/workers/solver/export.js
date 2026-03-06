import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
function arrayBufferToB64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
export async function exportOutcomeGlb(preservedGeometry, generatedGeometry) {
    const scene = new THREE.Scene();
    const preserved = new THREE.Mesh(preservedGeometry, new THREE.MeshStandardMaterial({
        color: 0x3bc282,
        metalness: 0.18,
        roughness: 0.58,
        transparent: true,
        opacity: 0.36
    }));
    preserved.name = "preserved";
    const generated = new THREE.Mesh(generatedGeometry, new THREE.MeshStandardMaterial({
        color: 0x2f353d,
        metalness: 0.55,
        roughness: 0.38,
        emissive: 0x0a1017,
        emissiveIntensity: 0.06
    }));
    generated.name = "generated";
    scene.add(preserved);
    scene.add(generated);
    const exporter = new GLTFExporter();
    const output = await new Promise((resolve, reject) => {
        exporter.parse(scene, (result) => {
            if (result instanceof ArrayBuffer) {
                resolve(result);
                return;
            }
            reject(new Error("GLTFExporter did not return binary output"));
        }, (error) => reject(error), { binary: true, onlyVisible: false });
    });
    return arrayBufferToB64(output);
}
