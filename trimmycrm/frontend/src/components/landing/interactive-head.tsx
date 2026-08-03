"use client";

import { Rotate3D } from "lucide-react";
import type { BufferGeometry, Material, Texture } from "three";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { TrimmyLoader } from "@/components/ui/trimmy-loader";

import styles from "./interactive-head.module.css";

type SceneStatus = "loading" | "ready" | "error";

const portraitSource = "/images/editorial/three-point-cloud-portrait.webp";

export function InteractiveHead() {
  const mountRef = useRef<HTMLDivElement>(null);
  const nudgeRef = useRef<(delta: number) => void>(() => undefined);
  const [status, setStatus] = useState<SceneStatus>("loading");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled = false;
    let cleanup = () => undefined;

    async function createScene() {
      try {
        const [THREE, { OrbitControls }] = await Promise.all([
          import("three"),
          import("three/examples/jsm/controls/OrbitControls.js"),
        ]);
        if (cancelled || !mount) return;

        const renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.domElement.className = styles.canvas;
        renderer.domElement.setAttribute("aria-hidden", "true");
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
        camera.position.set(0, -0.02, 6.25);

        const keyLight = new THREE.DirectionalLight(0xfff5eb, 2.8);
        keyLight.position.set(3.8, 4.5, 5.4);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0x75dfb5, 1.35);
        fillLight.position.set(-4, 1.4, 3);
        scene.add(fillLight);
        const rimLight = new THREE.DirectionalLight(0xd15022, 1.8);
        rimLight.position.set(3, 1.5, -4);
        scene.add(rimLight);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x385d52, 1.1));

        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const source = new Image();
          source.decoding = "async";
          source.onload = () => resolve(source);
          source.onerror = () => reject(new Error("Portrait source could not be loaded"));
          source.src = portraitSource;
        });
        if (cancelled) {
          renderer.dispose();
          renderer.domElement.remove();
          return;
        }

        const sampleWidth = 480;
        const sampleHeight = 600;
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = sampleWidth;
        sourceCanvas.height = sampleHeight;
        const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas2D is unavailable");
        context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
        const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight);

        const isBackground = (red: number, green: number, blue: number) => (
          green > 145
          && green - Math.max(red, blue) > 18
          && green > red * 1.2
          && blue > 95
        );
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
          const red = pixels.data[offset];
          const green = pixels.data[offset + 1];
          const blue = pixels.data[offset + 2];
          pixels.data[offset + 3] = isBackground(red, green, blue) ? 0 : 255;
        }
        context.putImageData(pixels, 0, 0);

        const depthAt = (u: number, v: number) => {
          const face = Math.exp(-Math.pow((u - 0.5) / 0.25, 2) - Math.pow((v - 0.68) / 0.31, 2));
          const hair = Math.exp(-Math.pow((u - 0.5) / 0.31, 2) - Math.pow((v - 0.86) / 0.19, 2));
          const shoulders = Math.exp(-Math.pow((u - 0.5) / 0.62, 2) - Math.pow((v - 0.12) / 0.24, 2));
          return face * 0.34 + hair * 0.21 + shoulders * 0.055;
        };

        const portraitTexture = new THREE.CanvasTexture(sourceCanvas);
        portraitTexture.colorSpace = THREE.SRGBColorSpace;
        portraitTexture.minFilter = THREE.LinearMipmapLinearFilter;
        portraitTexture.magFilter = THREE.LinearFilter;

        const portraitGeometry = new THREE.PlaneGeometry(2.55, 3.2, 72, 90);
        const portraitPositions = portraitGeometry.attributes.position;
        const portraitUvs = portraitGeometry.attributes.uv;
        for (let index = 0; index < portraitPositions.count; index += 1) {
          portraitPositions.setZ(index, depthAt(portraitUvs.getX(index), portraitUvs.getY(index)));
        }
        portraitGeometry.computeVertexNormals();
        const portraitMaterial = new THREE.MeshStandardMaterial({
          map: portraitTexture,
          transparent: true,
          alphaTest: 0.08,
          roughness: 0.78,
          metalness: 0,
          side: THREE.DoubleSide,
        });

        const pointPositions: number[] = [];
        const pointColors: number[] = [];
        for (let y = 0; y < sampleHeight; y += 4) {
          for (let x = 0; x < sampleWidth; x += 4) {
            const offset = (y * sampleWidth + x) * 4;
            if (pixels.data[offset + 3] < 128) continue;
            const u = x / (sampleWidth - 1);
            const v = 1 - y / (sampleHeight - 1);
            const red = pixels.data[offset] / 255;
            const green = pixels.data[offset + 1] / 255;
            const blue = pixels.data[offset + 2] / 255;
            const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
            pointPositions.push(
              (u - 0.5) * 2.55,
              (v - 0.5) * 3.2,
              depthAt(u, v) + 0.035 + (luminance - 0.5) * 0.025,
            );
            pointColors.push(red, green, blue);
          }
        }
        const pointGeometry = new THREE.BufferGeometry();
        pointGeometry.setAttribute("position", new THREE.Float32BufferAttribute(pointPositions, 3));
        pointGeometry.setAttribute("color", new THREE.Float32BufferAttribute(pointColors, 3));
        const pointMaterial = new THREE.PointsMaterial({
          size: 0.014,
          sizeAttenuation: true,
          vertexColors: true,
          transparent: true,
          opacity: 0.74,
        });

        const portrait = new THREE.Group();
        portrait.rotation.y = -0.07;
        portrait.add(new THREE.Mesh(portraitGeometry, portraitMaterial));
        portrait.add(new THREE.Points(pointGeometry, pointMaterial));
        scene.add(portrait);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.055;
        controls.enablePan = false;
        controls.enableZoom = false;
        controls.minPolarAngle = Math.PI * 0.46;
        controls.maxPolarAngle = Math.PI * 0.54;
        controls.minAzimuthAngle = -0.34;
        controls.maxAzimuthAngle = 0.34;
        controls.target.set(0, 0, 0.08);
        controls.update();

        mount.dataset.rotation = portrait.rotation.y.toFixed(2);
        nudgeRef.current = (delta) => {
          portrait.rotation.y = THREE.MathUtils.clamp(portrait.rotation.y + delta, -0.32, 0.32);
          mount.dataset.rotation = portrait.rotation.y.toFixed(2);
          renderer.render(scene, camera);
        };

        const resize = () => {
          const { width, height } = mount.getBoundingClientRect();
          if (!width || !height) return;
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
        };
        const observer = new ResizeObserver(resize);
        observer.observe(mount);
        resize();

        renderer.setAnimationLoop(() => {
          controls.update();
          renderer.render(scene, camera);
        });
        setStatus("ready");

        cleanup = () => {
          observer.disconnect();
          renderer.setAnimationLoop(null);
          controls.dispose();
          const geometries = new Set<BufferGeometry>();
          const materials = new Set<Material>();
          const textures = new Set<Texture>([portraitTexture]);
          scene.traverse((object) => {
            const drawable = object as typeof object & {
              geometry?: BufferGeometry;
              material?: Material | Material[];
            };
            if (drawable.geometry) geometries.add(drawable.geometry);
            if (drawable.material) {
              const objectMaterials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
              objectMaterials.forEach((material) => materials.add(material));
            }
          });
          geometries.forEach((geometry) => geometry.dispose());
          materials.forEach((material) => material.dispose());
          textures.forEach((texture) => texture.dispose());
          renderer.dispose();
          renderer.domElement.remove();
          delete mount.dataset.rotation;
        };
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void createScene();
    return () => {
      cancelled = true;
      nudgeRef.current = () => undefined;
      cleanup();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    nudgeRef.current(event.key === "ArrowLeft" ? -0.1 : 0.1);
  }

  return (
    <div className={styles.stage} data-parallax data-status={status}>
      <div
        className={styles.viewport}
        ref={mountRef}
        role="application"
        tabIndex={0}
        aria-label="Интерактивный 3D-портрет с короткой стрижкой. Поверните его перетаскиванием или стрелками."
        onKeyDown={handleKeyDown}
      >
        <div className={styles.loader} aria-hidden={status === "ready"}>
          <TrimmyLoader size="lg" label={status === "error" ? "3D недоступно" : "Загружаем 3D-портрет"} />
          <small>{status === "error" ? "3D недоступно" : "Готовим модель"}</small>
        </div>
      </div>
      <span className={styles.control} aria-hidden="true"><Rotate3D /></span>
      <div className={styles.plane} aria-hidden="true" />
    </div>
  );
}
