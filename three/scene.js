import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createThreeScene(canvas) {
  const clock = new THREE.Clock();
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const camera = createCamera();
  const controls = createControls(camera, renderer.domElement);

  scene.name = 'Three.js Scene';
  camera.name = 'Camera';
  scene.background = new THREE.Color(0x11130f);
  scene.fog = new THREE.Fog(0x11130f, 36, 160);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x11130f, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  function start(onFrame) {
    const animate = () => {
      requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.elapsedTime;

      resizeRenderer(canvas, renderer, camera);
      runSceneUpdaters(scene, { delta, elapsed, scene, camera, renderer, controls });
      onFrame?.({ delta, elapsed, scene, camera, renderer, controls });
      controls.update();
      renderer.render(scene, camera);
    };

    animate();
  }

  function frameObject(object) {
    const target = object?.userData?.frameTarget ?? object;
    const bounds = new THREE.Box3().setFromObject(target);
    const size = bounds.isEmpty()
      ? new THREE.Vector3(1, 1, 1)
      : bounds.getSize(new THREE.Vector3());
    const center = bounds.isEmpty()
      ? controls.target.clone()
      : bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1);

    controls.target.copy(center);
    camera.position.set(center.x + radius * 0.85, center.y + radius * 0.45, center.z + radius * 1.45);
    camera.near = 0.01;
    camera.far = 1000;
    camera.updateProjectionMatrix();

    controls.minDistance = Math.max(radius * 0.12, 0.45);
    controls.maxDistance = Math.max(radius * 8, 80);
    controls.update();
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    frameObject,
    start,
  };
}

function createCamera() {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
  camera.position.set(3.3, 2.1, 5);
  return camera;
}

function createControls(camera, domElement) {
  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 0.95, 0);
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.6;
  controls.minDistance = 0.55;
  controls.maxDistance = 80;
  controls.minPolarAngle = Math.PI * 0.08;
  controls.maxPolarAngle = Math.PI * 0.58;
  controls.update();
  return controls;
}

function resizeRenderer(canvas, renderer, camera) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = renderer.getPixelRatio();
  const needsResize = canvas.width !== Math.floor(width * pixelRatio)
    || canvas.height !== Math.floor(height * pixelRatio);

  if (needsResize) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function runSceneUpdaters(scene, frame) {
  scene.traverse((object) => {
    if (typeof object.userData.update === 'function') {
      object.userData.update(frame);
    }
  });
}
