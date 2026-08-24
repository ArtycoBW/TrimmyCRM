import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type SalonWorldOptions = {
  mount: HTMLDivElement;
  story: HTMLElement;
  reducedMotion: boolean;
  onProgress?: (progress: number) => void;
  onReady: () => void;
  onError: (error: unknown) => void;
};

type ModelKey = "lamp" | "table" | "cabinet";

const MODEL_URLS: Record<ModelKey, string> = {
  lamp: "/models/salon/modern_ceiling_lamp_01.glb",
  table: "/models/salon/modern_coffee_table_01.glb",
  cabinet: "/models/salon/modern_wooden_cabinet.glb",
};

const CAMERA_KEYS = [
  { at: 0, position: new THREE.Vector3(0, 2.05, 11.5), target: new THREE.Vector3(0, 1.35, 2.2) },
  { at: 0.2, position: new THREE.Vector3(2.75, 1.9, 5.2), target: new THREE.Vector3(-2.8, 1.35, -3.8) },
  { at: 0.42, position: new THREE.Vector3(-2.6, 1.7, -2.5), target: new THREE.Vector3(2.9, 1.28, -10.5) },
  { at: 0.64, position: new THREE.Vector3(2.35, 2.05, -11.4), target: new THREE.Vector3(-2.7, 1.35, -18.4) },
  { at: 0.83, position: new THREE.Vector3(-1.2, 1.78, -20.1), target: new THREE.Vector3(0.2, 1.35, -28.6) },
  { at: 1, position: new THREE.Vector3(0, 2.55, -24.2), target: new THREE.Vector3(0, 1.25, -31.3) },
] as const;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function cloneMaterial(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material.map((item) => item.clone()) : material.clone();
}

function prepareModel(source: THREE.Object3D, targetSize: number) {
  const model = source.clone(true);
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = cloneMaterial(child.material);
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.envMapIntensity = 1.25;
        material.needsUpdate = true;
      }
    });
  });

  const initialBounds = new THREE.Box3().setFromObject(model);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  model.scale.setScalar(targetSize / Math.max(initialSize.x, initialSize.y, initialSize.z, 0.001));
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -bounds.min.y, -center.z);

  const wrapper = new THREE.Group();
  wrapper.add(model);
  return wrapper;
}

function addArchitecture(scene: THREE.Scene) {
  const plaster = new THREE.MeshStandardMaterial({ color: 0xd8dedb, roughness: 0.72, metalness: 0.02 });
  const darkPaint = new THREE.MeshStandardMaterial({ color: 0x172321, roughness: 0.5, metalness: 0.12 });
  const floorMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x696f6c,
    roughness: 0.27,
    metalness: 0.13,
    clearcoat: 0.34,
    clearcoatRoughness: 0.45,
  });
  const wood = new THREE.MeshPhysicalMaterial({ color: 0x4a3025, roughness: 0.38, metalness: 0.02, clearcoat: 0.34 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x384341, roughness: 0.24, metalness: 0.9 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x8ba9a4,
    roughness: 0.08,
    metalness: 0.84,
    transparent: true,
    opacity: 0.86,
    clearcoat: 1,
  });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 46), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -11);
  floor.receiveShadow = true;
  scene.add(floor);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.25, 5.5, 46), plaster);
  leftWall.position.set(-7, 2.75, -11);
  leftWall.receiveShadow = true;
  const rightWall = leftWall.clone();
  rightWall.position.x = 7;
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(14.25, 0.22, 46), darkPaint);
  ceiling.position.set(0, 5.55, -11);
  ceiling.receiveShadow = true;
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(14.25, 5.5, 0.28), darkPaint);
  backWall.position.set(0, 2.75, -34);
  backWall.receiveShadow = true;
  scene.add(leftWall, rightWall, ceiling, backWall);

  const slatGeometry = new THREE.BoxGeometry(0.1, 5.2, 0.18);
  for (let index = 0; index < 18; index += 1) {
    const slat = new THREE.Mesh(slatGeometry, wood);
    slat.position.set(-5.6 + index * 0.66, 2.65, -33.78);
    slat.castShadow = true;
    scene.add(slat);
  }

  const desk = new THREE.Group();
  const deskBody = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.22, 1.15), wood);
  deskBody.position.y = 0.61;
  deskBody.castShadow = true;
  deskBody.receiveShadow = true;
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.12, 1.38), metal);
  deskTop.position.y = 1.26;
  deskTop.castShadow = true;
  desk.add(deskBody, deskTop);
  desk.position.set(-3.9, 0, 9.1);
  desk.rotation.y = 0.05;
  scene.add(desk);

  const portal = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.085, 24, 96), metal);
  ring.castShadow = true;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.02, 96), glass);
  disc.position.z = -0.04;
  portal.add(disc, ring);
  portal.position.set(0, 2.65, -33.52);
  scene.add(portal);

  const ledMaterial = new THREE.MeshBasicMaterial({ color: 0xd5eee6, toneMapped: false });
  for (let index = 0; index < 9; index += 1) {
    const lightStrip = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.045, 0.1), ledMaterial);
    lightStrip.position.set(0, 5.39, 7 - index * 4.6);
    scene.add(lightStrip);
  }

  return [plaster, darkPaint, floorMaterial, wood, metal, glass, ledMaterial];
}

function roundedRectangle(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const left = -width / 2;
  const right = width / 2;
  const bottom = -height / 2;
  const top = height / 2;
  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + radius);
  shape.lineTo(right, top - radius);
  shape.quadraticCurveTo(right, top, right - radius, top);
  shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);
  return shape;
}

function createMirrorStation(side: "left" | "right") {
  const station = new THREE.Group();
  const outer = roundedRectangle(2.05, 3.35, 0.28);
  const inner = roundedRectangle(1.78, 3.08, 0.22);
  outer.holes.push(new THREE.Path(inner.getPoints(40)));

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x263230, roughness: 0.25, metalness: 0.84 });
  const mirrorMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xa9bbb7,
    roughness: 0.06,
    metalness: 0.88,
    side: THREE.DoubleSide,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  const shelfMaterial = new THREE.MeshPhysicalMaterial({ color: 0x2f3432, roughness: 0.23, metalness: 0.65, clearcoat: 0.45 });
  const ledMaterial = new THREE.MeshBasicMaterial({ color: 0xe0f2ec, toneMapped: false });

  // Build the mirror and shelf as one rigid module. Each side is turned toward
  // its chair, with local z=0 seated directly against the side wall.
  const wallPlate = new THREE.Mesh(new RoundedBoxGeometry(2.18, 3.48, 0.025, 4, 0.25), shelfMaterial);
  wallPlate.position.z = 0.0125;
  wallPlate.castShadow = true;
  wallPlate.receiveShadow = true;
  const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.065, bevelEnabled: false }), frameMaterial);
  frame.castShadow = true;
  const mirror = new THREE.Mesh(new THREE.ShapeGeometry(inner, 40), mirrorMaterial);
  mirror.position.z = 0.052;
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.085, 0.42), shelfMaterial);
  shelf.position.set(0, -1.88, 0.21);
  shelf.castShadow = true;
  const leftLed = new THREE.Mesh(new THREE.BoxGeometry(0.028, 2.65, 0.025), ledMaterial);
  leftLed.position.set(-0.93, 0, 0.105);
  const rightLed = leftLed.clone();
  rightLed.position.x = 0.93;
  station.add(wallPlate, frame, mirror, shelf, leftLed, rightLed);
  station.rotation.y = side === "left" ? Math.PI / 2 : (-Math.PI / 2);
  station.userData.mountNormal = side === "left" ? "+x" : "-x";
  station.userData.ownedMaterials = [frameMaterial, mirrorMaterial, shelfMaterial, ledMaterial];
  return station;
}

function createLeatherTextureSet() {
  const size = 96;
  const roughnessData = new Uint8Array(size * size * 4);
  const normalData = new Uint8Array(size * size * 4);
  let seed = 0x7f4a7c15;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let index = 0; index < size * size; index += 1) {
    const offset = index * 4;
    const grain = (random() + random() + random()) / 3 - 0.5;
    const roughness = Math.round(110 + grain * 28);
    roughnessData.set([roughness, roughness, roughness, 255], offset);
    normalData.set([
      Math.round(128 + grain * 15),
      Math.round(128 + (random() - 0.5) * 14),
      252,
      255,
    ], offset);
  }

  const roughnessMap = new THREE.DataTexture(roughnessData, size, size, THREE.RGBAFormat);
  const normalMap = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
  [roughnessMap, normalMap].forEach((texture) => {
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 5);
    texture.needsUpdate = true;
  });
  return { roughnessMap, normalMap };
}

function addPart(group: THREE.Group, mesh: THREE.Mesh, name: string) {
  mesh.name = name;
  mesh.userData.sculptPart = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function createRod(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  name: string,
) {
  const direction = end.clone().sub(start);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 18), material);
  rod.position.copy(start).add(end).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  rod.name = name;
  rod.userData.sculptPart = name;
  rod.castShadow = true;
  return rod;
}

function createModernSalonChair() {
  const chair = new THREE.Group();
  chair.name = "ModernSalonChair";
  chair.userData.sculptPart = "modern-salon-chair";

  const { roughnessMap, normalMap } = createLeatherTextureSet();
  const leather = new THREE.MeshPhysicalMaterial({
    color: 0x171716,
    roughness: 0.36,
    roughnessMap,
    normalMap,
    normalScale: new THREE.Vector2(0.12, 0.12),
    metalness: 0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.5,
    sheen: 0.32,
    sheenColor: new THREE.Color(0x5a453a),
    sheenRoughness: 0.62,
    envMapIntensity: 1.15,
  });
  const leatherEdge = leather.clone();
  leatherEdge.color.setHex(0x27221f);
  leatherEdge.roughness = 0.31;
  const seam = new THREE.MeshStandardMaterial({ color: 0x090b0b, roughness: 0.72, metalness: 0 });
  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xe2e7e6,
    roughness: 0.115,
    metalness: 1,
    clearcoat: 0.25,
    clearcoatRoughness: 0.12,
    envMapIntensity: 2.1,
  });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x151b1a, roughness: 0.3, metalness: 0.82 });

  const base = addPart(chair, new THREE.Mesh(new THREE.CylinderGeometry(0.91, 1.02, 0.16, 72), chrome), "floor-base");
  base.position.y = 0.08;
  const baseRim = addPart(chair, new THREE.Mesh(new THREE.TorusGeometry(0.955, 0.035, 12, 72), chrome), "base-rolled-rim");
  baseRim.rotation.x = Math.PI / 2;
  baseRim.position.y = 0.075;
  const floorGasket = addPart(chair, new THREE.Mesh(new THREE.CylinderGeometry(0.93, 0.97, 0.025, 72), darkMetal), "floor-gasket");
  floorGasket.position.y = 0.018;

  const column = addPart(chair, new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.26, 0.72, 48), chrome), "hydraulic-column");
  column.position.y = 0.52;
  [0.2, 0.76].forEach((y, index) => {
    const collar = addPart(chair, new THREE.Mesh(new THREE.TorusGeometry(index ? 0.225 : 0.27, 0.027, 12, 48), chrome), `hydraulic-collar-${index + 1}`);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = y;
  });
  const support = addPart(chair, new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.36, 0.1, 48), darkMetal), "underseat-plate");
  support.position.y = 0.94;

  const seat = addPart(chair, new THREE.Mesh(new RoundedBoxGeometry(1.38, 0.34, 1.02, 6, 0.14), leather), "seat-cushion");
  seat.position.set(0, 1.16, 0.05);
  const back = addPart(chair, new THREE.Mesh(new RoundedBoxGeometry(1.52, 1.08, 0.3, 7, 0.16), leather), "back-cushion");
  back.position.set(0, 1.84, -0.43);
  back.rotation.x = -0.065;

  const leftArm = addPart(chair, new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.76, 1.16, 6, 0.14), leather), "arm-left");
  leftArm.position.set(-0.76, 1.46, 0.01);
  leftArm.rotation.z = 0.018;
  const rightArm = addPart(chair, new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.76, 1.16, 6, 0.14), leather), "arm-right");
  rightArm.position.set(0.76, 1.46, 0.01);
  rightArm.rotation.z = -0.018;

  [-0.48, -0.24, 0, 0.24, 0.48].forEach((x, index) => {
    const channel = addPart(chair, new THREE.Mesh(new RoundedBoxGeometry(0.022, 0.76, 0.014, 3, 0.009), seam), `back-channel-${index + 1}`);
    channel.position.set(x, 1.85, -0.265);
    channel.rotation.x = -0.065;
    channel.userData.explodeWithParent = true;
  });

  const topPiping = addPart(chair, new THREE.Mesh(new RoundedBoxGeometry(1.28, 0.036, 0.035, 3, 0.017), leatherEdge), "back-top-piping");
  topPiping.position.set(0, 2.365, -0.265);
  const leftPiping = addPart(chair, new THREE.Mesh(new RoundedBoxGeometry(0.036, 0.82, 0.035, 3, 0.017), leatherEdge), "back-left-piping");
  leftPiping.position.set(-0.745, 1.85, -0.265);
  const rightPiping = leftPiping.clone();
  rightPiping.name = "back-right-piping";
  rightPiping.userData.sculptPart = "back-right-piping";
  rightPiping.position.x = 0.745;
  chair.add(rightPiping);
  const seatSeam = addPart(chair, new THREE.Mesh(new RoundedBoxGeometry(1.15, 0.025, 0.026, 3, 0.012), seam), "seat-front-seam");
  seatSeam.position.set(0, 1.16, 0.565);

  const pump = createRod(new THREE.Vector3(0.19, 0.62, 0.06), new THREE.Vector3(0.58, 0.28, 0.7), 0.035, chrome, "pump-pedal");
  chair.add(pump);
  const pumpGrip = createRod(new THREE.Vector3(0.42, 0.27, 0.76), new THREE.Vector3(0.82, 0.27, 0.76), 0.045, chrome, "pump-grip");
  chair.add(pumpGrip);
  const release = createRod(new THREE.Vector3(-0.18, 0.68, 0.02), new THREE.Vector3(-0.58, 0.68, 0.22), 0.032, chrome, "release-lever");
  chair.add(release);
  const pivot = addPart(chair, new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.09, 24), darkMetal), "pedal-pivot");
  pivot.rotation.z = Math.PI / 2;
  pivot.position.set(0.19, 0.63, 0.06);

  const footrest = new THREE.Group();
  footrest.name = "footrest";
  footrest.userData.sculptPart = "footrest";
  footrest.add(
    createRod(new THREE.Vector3(-0.4, 0.43, 0.44), new THREE.Vector3(-0.4, 0.43, 0.95), 0.027, chrome, "footrest-left"),
    createRod(new THREE.Vector3(0.4, 0.43, 0.44), new THREE.Vector3(0.4, 0.43, 0.95), 0.027, chrome, "footrest-right"),
    createRod(new THREE.Vector3(-0.4, 0.43, 0.95), new THREE.Vector3(0.4, 0.43, 0.95), 0.035, chrome, "footrest-front"),
  );
  chair.add(footrest);

  chair.userData.ownedMaterials = [leather, leatherEdge, seam, chrome, darkMetal];
  chair.userData.ownedTextures = [roughnessMap, normalMap];
  return chair;
}

function addModelInstance(
  template: THREE.Group,
  scene: THREE.Scene,
  options: { position: [number, number, number]; rotationY?: number; interactive?: boolean; hoverColor?: number; haloRadius?: number },
) {
  const instance = template.clone(true) as THREE.Group;
  instance.position.set(...options.position);
  instance.rotation.y = options.rotationY ?? 0;
  if (options.interactive) {
    instance.userData.interactive = true;
    instance.userData.hovered = false;
    instance.userData.hoverAmount = 0;
    instance.userData.baseY = instance.position.y;
    const haloRadius = options.haloRadius ?? 0.78;
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(haloRadius * 0.87, haloRadius, 64),
      new THREE.MeshBasicMaterial({
        color: options.hoverColor ?? 0x75dfb5,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.name = "hover-halo";
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.018;
    instance.add(halo);
  }
  scene.add(instance);
  return instance;
}

function sampleCamera(progress: number, position: THREE.Vector3, target: THREE.Vector3) {
  const finalIndex = CAMERA_KEYS.length - 1;
  let index = 0;
  while (index < finalIndex - 1 && progress > CAMERA_KEYS[index + 1].at) index += 1;
  const from = CAMERA_KEYS[index];
  const to = CAMERA_KEYS[Math.min(index + 1, finalIndex)];
  const range = Math.max(to.at - from.at, 0.001);
  const local = THREE.MathUtils.smoothstep(clamp((progress - from.at) / range), 0, 1);
  position.lerpVectors(from.position, to.position, local);
  target.lerpVectors(from.target, to.target, local);
}

export async function createRealisticSalonWorld(options: SalonWorldOptions) {
  const { mount, story, reducedMotion, onProgress, onReady, onError } = options;
  let disposed = false;
  let cleanup = () => undefined;

  try {
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: !coarsePointer,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarsePointer ? 1.2 : 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !coarsePointer;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.dataset.salonWebgl = "true";
    mount.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1b2927);
    scene.fog = new THREE.FogExp2(0x1b2927, 0.0145);
    const camera = new THREE.PerspectiveCamera(47, 1, 0.08, 90);
    camera.position.copy(CAMERA_KEYS[0].position);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    const environment = pmrem.fromScene(roomEnvironment, 0.035).texture;
    scene.environment = environment;

    const architectureMaterials = addArchitecture(scene);
    const salonChairTemplate = createModernSalonChair();

    const hemisphere = new THREE.HemisphereLight(0xe9f5f1, 0x27302e, 1.7);
    const keyLight = new THREE.DirectionalLight(0xfff0df, 2.25);
    keyLight.position.set(-4, 8.5, 10);
    keyLight.castShadow = !coarsePointer;
    keyLight.shadow.mapSize.set(coarsePointer ? 512 : 1536, coarsePointer ? 512 : 1536);
    keyLight.shadow.camera.left = -11;
    keyLight.shadow.camera.right = 11;
    keyLight.shadow.camera.top = 14;
    keyLight.shadow.camera.bottom = -14;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 60;
    keyLight.shadow.bias = -0.00015;
    const portalLight = new THREE.PointLight(0x75dfb5, 20, 16, 2);
    portalLight.position.set(0, 2.65, -32.4);
    const receptionLight = new THREE.PointLight(0xffd1aa, 8, 10, 2);
    receptionLight.position.set(-3.5, 3.5, 8);
    scene.add(hemisphere, keyLight, portalLight, receptionLight);

    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => onProgress?.(total ? loaded / total : 0);
    const loader = new GLTFLoader(manager);
    const entries = await Promise.all(
      (Object.entries(MODEL_URLS) as [ModelKey, string][]).map(async ([key, url]) => [key, await loader.loadAsync(url)] as const),
    );
    if (disposed) {
      renderer.dispose();
      renderer.domElement.remove();
      return () => undefined;
    }
    const loaded = Object.fromEntries(entries) as Record<ModelKey, Awaited<ReturnType<GLTFLoader["loadAsync"]>>>;
    const templates = {
      lamp: prepareModel(loaded.lamp.scene, 1.22),
      table: prepareModel(loaded.table.scene, 2.65),
      cabinet: prepareModel(loaded.cabinet.scene, 4.35),
    };

    const interactive: THREE.Group[] = [];
    const mirrorStationX = 6.275;
    [4.2, -2.3, -8.8, -15.3, -21.7].forEach((z, index) => {
      const leftChair = addModelInstance(salonChairTemplate, scene, {
        position: [-4.05, 0, z],
        rotationY: Math.PI / 2,
        interactive: true,
        haloRadius: 1.1,
      });
      const rightChair = addModelInstance(salonChairTemplate, scene, {
        position: [4.05, 0, z - 1.2],
        rotationY: -Math.PI / 2,
        interactive: true,
        haloRadius: 1.1,
      });
      interactive.push(leftChair, rightChair);

      const leftMirror = addModelInstance(createMirrorStation("left"), scene, {
        position: [-mirrorStationX, 2.38, z - 3.25],
        rotationY: Math.PI / 2,
        interactive: index < 2,
      });
      const rightMirror = addModelInstance(createMirrorStation("right"), scene, {
        position: [mirrorStationX, 2.38, z - 1.45],
        rotationY: -Math.PI / 2,
        interactive: index < 2,
      });
      if (index < 2) interactive.push(leftMirror, rightMirror);
    });

    [6, 0.8, -4.4, -9.6, -14.8, -20, -25.2].forEach((z) => {
      const lamp = addModelInstance(templates.lamp, scene, { position: [0, 4.22, z] });
      lamp.rotation.x = Math.PI;
      const glow = new THREE.PointLight(0xffe0be, 3.5, 8, 2);
      glow.position.set(0, 4.72, z);
      scene.add(glow);
    });

    const waitingLeft = addModelInstance(salonChairTemplate, scene, {
      position: [-1.72, 0, -30.2],
      rotationY: -0.38,
      interactive: true,
      haloRadius: 1.1,
    });
    const waitingRight = addModelInstance(salonChairTemplate, scene, {
      position: [1.72, 0, -30.2],
      rotationY: 0.38,
      interactive: true,
      haloRadius: 1.1,
    });
    waitingLeft.userData.hoverScale = 1.01;
    waitingRight.userData.hoverScale = 1.01;
    interactive.push(waitingLeft, waitingRight);
    addModelInstance(templates.table, scene, { position: [0, 0, -28.25] });
    addModelInstance(templates.cabinet, scene, { position: [-6.62, 0, -28.1], rotationY: Math.PI / 2 });
    addModelInstance(templates.cabinet, scene, { position: [6.62, 0, -28.1], rotationY: -Math.PI / 2 });

    interactive.forEach((root) => {
      root.traverse((child) => {
        if (child instanceof THREE.Mesh) child.userData.interactiveRoot = root;
      });
    });

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = width < 760 ? 58 : 47;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(4, 4);
    const pointerTarget = new THREE.Vector2();
    const onPointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
      pointerTarget.set(pointer.x, pointer.y);
    };
    const onPointerLeave = () => {
      pointer.set(4, 4);
      pointerTarget.set(0, 0);
    };
    mount.addEventListener("pointermove", onPointerMove, { passive: true });
    mount.addEventListener("pointerleave", onPointerLeave, { passive: true });

    let visible = true;
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    }, { rootMargin: "30%" });
    intersectionObserver.observe(story);

    const cameraPosition = new THREE.Vector3();
    const cameraTarget = new THREE.Vector3();
    const desiredPosition = new THREE.Vector3();
    const desiredTarget = new THREE.Vector3();
    const easedPointer = new THREE.Vector2();
    let progress = reducedMotion ? 0.08 : 0;
    let previousTime = performance.now();
    let hovered: THREE.Group | null = null;

    const render = (time: number) => {
      if (!visible && !reducedMotion) return;
      const delta = clamp((time - previousTime) / 1000, 0, 0.05);
      previousTime = time;
      const rect = story.getBoundingClientRect();
      const travel = Math.max(rect.height - window.innerHeight, 1);
      const targetProgress = reducedMotion ? 0.08 : clamp(-rect.top / travel);
      progress += (targetProgress - progress) * (1 - Math.exp(-delta * 8.5));
      easedPointer.lerp(pointerTarget, 1 - Math.exp(-delta * 4.8));

      sampleCamera(progress, desiredPosition, desiredTarget);
      desiredPosition.x += easedPointer.x * 0.22;
      desiredPosition.y += easedPointer.y * 0.08;
      cameraPosition.lerp(desiredPosition, 1 - Math.exp(-delta * 7.5));
      cameraTarget.lerp(desiredTarget, 1 - Math.exp(-delta * 7.5));
      camera.position.copy(cameraPosition);
      camera.lookAt(cameraTarget);

      if (!coarsePointer && !reducedMotion) {
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(interactive, true)[0];
        const nextHovered = (hit?.object.userData.interactiveRoot as THREE.Group | undefined) ?? null;
        if (hovered !== nextHovered) {
          if (hovered) hovered.userData.hovered = false;
          hovered = nextHovered;
          if (hovered) hovered.userData.hovered = true;
          mount.dataset.modelHover = hovered ? "true" : "false";
        }
      }

      interactive.forEach((root) => {
        const targetHover = root.userData.hovered ? 1 : 0;
        root.userData.hoverAmount += (targetHover - root.userData.hoverAmount) * (1 - Math.exp(-delta * 10));
        const hoverAmount = root.userData.hoverAmount as number;
        const scale = 1 + hoverAmount * ((root.userData.hoverScale as number | undefined) ?? 0.014);
        root.scale.setScalar(scale);
        root.position.y = (root.userData.baseY as number) + hoverAmount * 0.045;
        const halo = root.getObjectByName("hover-halo") as THREE.Mesh | undefined;
        const haloMaterial = halo?.material;
        if (haloMaterial instanceof THREE.MeshBasicMaterial) haloMaterial.opacity = hoverAmount * 0.74;
      });

      portalLight.intensity = 18 + Math.sin(time * 0.0018) * 3.5;
      story.style.setProperty("--story-progress", progress.toFixed(4));
      renderer.render(scene, camera);
    };

    sampleCamera(progress, cameraPosition, cameraTarget);
    renderer.setAnimationLoop(render);
    render(performance.now());
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (disposed) return () => undefined;
    onReady();

    cleanup = () => {
      renderer.setAnimationLoop(null);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerleave", onPointerLeave);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
        meshMaterials.forEach((material) => {
          materials.add(material);
          Object.values(material).forEach((value) => {
            if (value instanceof THREE.Texture) textures.add(value);
          });
        });
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      architectureMaterials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      environment.dispose();
      roomEnvironment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  } catch (error) {
    if (!disposed) onError(error);
  }

  return () => {
    disposed = true;
    cleanup();
  };
}
