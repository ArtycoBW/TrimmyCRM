"use client";

import { Rotate3D } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { TrimmyLoader } from "@/components/ui/trimmy-loader";

import styles from "./interactive-head.module.css";

type SceneStatus = "loading" | "ready" | "error";

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
        const [THREE, { GLTFLoader }, { OrbitControls }] = await Promise.all([
          import("three"),
          import("three/examples/jsm/loaders/GLTFLoader.js"),
          import("three/examples/jsm/controls/OrbitControls.js"),
        ]);
        if (cancelled || !mount) return;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.02;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.domElement.className = styles.canvas;
        renderer.domElement.setAttribute("aria-hidden", "true");
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 30);
        camera.position.set(0, 0.02, 5.45);

        const keyLight = new THREE.DirectionalLight(0xfff8f0, 3.4);
        keyLight.position.set(3.6, 4.4, 4.8);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x75dfb5, 2.25);
        fillLight.position.set(-3.8, 1.4, 2.2);
        scene.add(fillLight);
        const rimLight = new THREE.DirectionalLight(0xd15022, 2.4);
        rimLight.position.set(2.2, 1.2, -4.2);
        scene.add(rimLight);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x496e61, 1.2));

        const head = new THREE.Group();
        head.rotation.set(0.02, -0.24, -0.012);
        scene.add(head);

        const gltf = await new GLTFLoader().loadAsync(
          "/models/marble-bust-01/marble_bust_01_1k.gltf",
        );
        if (cancelled) {
          renderer.dispose();
          return;
        }

        const model = gltf.scene;
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if ("roughness" in material) material.roughness = Math.max(material.roughness, 0.38);
          });
        });

        const originalBounds = new THREE.Box3().setFromObject(model);
        const originalSize = originalBounds.getSize(new THREE.Vector3());
        model.scale.setScalar(3.02 / originalSize.y);
        const scaledBounds = new THREE.Box3().setFromObject(model);
        const scaledCenter = scaledBounds.getCenter(new THREE.Vector3());
        model.position.sub(scaledCenter);
        model.position.y += 0.03;
        head.add(model);

        const shadow = new THREE.Mesh(
          new THREE.CircleGeometry(1.05, 64),
          new THREE.ShadowMaterial({ color: 0x063c2e, opacity: 0.2 }),
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(0, -1.49, 0.1);
        shadow.receiveShadow = true;
        scene.add(shadow);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.065;
        controls.enablePan = false;
        controls.enableZoom = false;
        controls.autoRotate = !reducedMotion;
        controls.autoRotateSpeed = 0.34;
        controls.minPolarAngle = Math.PI * 0.39;
        controls.maxPolarAngle = Math.PI * 0.59;
        controls.minAzimuthAngle = -Math.PI * 0.64;
        controls.maxAzimuthAngle = Math.PI * 0.64;
        controls.target.set(0, 0.04, 0);
        controls.update();

        mount.dataset.rotation = head.rotation.y.toFixed(2);
        nudgeRef.current = (delta) => {
          head.rotation.y += delta;
          mount.dataset.rotation = head.rotation.y.toFixed(2);
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
          scene.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => material.dispose());
          });
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
    nudgeRef.current(event.key === "ArrowLeft" ? -0.14 : 0.14);
  }

  return (
    <div className={styles.stage} data-parallax data-status={status}>
      <div
        className={styles.viewport}
        ref={mountRef}
        role="application"
        tabIndex={0}
        aria-label="Интерактивная 3D-модель головы с объёмной стрижкой. Поверните модель перетаскиванием или стрелками."
        onKeyDown={handleKeyDown}
      >
        <div className={styles.loader} aria-hidden={status === "ready"}>
          <TrimmyLoader size="lg" label={status === "error" ? "3D недоступно" : "Загружаем 3D-модель"} />
          <small>{status === "error" ? "3D недоступно" : "Собираем образ"}</small>
        </div>
      </div>
      <span className={styles.control} aria-hidden="true"><Rotate3D /></span>
      <div className={styles.plane} aria-hidden="true" />
    </div>
  );
}
