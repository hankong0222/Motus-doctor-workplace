import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const DEFAULT_GYM_MODEL_URL = '/asset/cJM4ngRqXg83-m53zo7W4E51E.glb';

export function createGymEnvironment({
  floorSize = 240,
  modelUrl = DEFAULT_GYM_MODEL_URL,
  modelHeight = 2.35,
  modelPosition = new THREE.Vector3(0, 0, 0),
} = {}) {
  const lightRig = createLightRig();
  const gridFloor = new THREE.Group();
  const floorRoot = createGridFloor(floorSize);
  const modelAssets = createGymModel(modelUrl, {
    height: modelHeight,
    position: modelPosition,
  });
  const { modelRoot } = modelAssets;
  const modelReady = modelAssets.modelReady.then((result) => {
    if (result?.animationStartPoint) {
      centerGymOnAnimationStart(gridFloor, floorRoot, result.animationStartPoint);
    }

    return result;
  });

  lightRig.name = 'Light';
  floorRoot.name = 'Infinite gym floor';
  gridFloor.name = 'Infinite gym';
  gridFloor.add(floorRoot, modelRoot);
  gridFloor.userData.frameTarget = floorRoot;

  return {
    lightRig,
    gridFloor,
    floorRoot,
    modelRoot,
    modelReady,
  };
}

function createLightRig() {
  const group = new THREE.Group();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x303030, 2.4);
  hemi.name = 'Hemisphere fill';
  group.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 3.5);
  key.name = 'Key light';
  key.position.set(4.5, 6.5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 18;
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  group.add(key);

  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.name = 'Cool rim light';
  fill.position.set(-3, 2, -2);
  group.add(fill);

  return group;
}

function createGridFloor(floorSize) {
  const group = new THREE.Group();
  const size = Math.max(72, Math.round(floorSize));
  const gridSpacing = 1;
  const majorGridSpacing = 6;
  const divisions = Math.max(1, Math.round(size / gridSpacing));
  const majorDivisions = Math.max(1, Math.round(size / majorGridSpacing));

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({
      color: 0x1f211f,
      roughness: 0.88,
      metalness: 0,
    }),
  );
  floor.name = 'Simple floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  followCameraOnXZ(floor, 2);
  group.add(floor);

  const grid = new THREE.GridHelper(size, divisions, 0x8d8d8d, 0x3f433f);
  grid.name = 'Reference grid';
  grid.position.y = 0.003;
  followCameraOnXZ(grid, gridSpacing);
  group.add(grid);

  const majorGrid = new THREE.GridHelper(size, majorDivisions, 0xaaaaaa, 0x575c57);
  majorGrid.name = 'Major reference grid';
  majorGrid.position.y = 0.006;
  followCameraOnXZ(majorGrid, majorGridSpacing);
  group.add(majorGrid);

  return group;
}

function createGymModel(url, { height, position }) {
  const modelRoot = new THREE.Group();
  modelRoot.name = 'Gym GLB model';
  modelRoot.position.copy(toVector3(position));

  if (!url) {
    return {
      modelRoot,
      modelReady: Promise.resolve(null),
    };
  }

  const loader = new GLTFLoader();
  const modelReady = loader.loadAsync(url).then((gltf) => {
    const model = gltf.scene;
    model.name = 'Loaded GLB model';
    prepareModel(model);
    fitModelToFloor(model, height);
    modelRoot.add(model);
    modelRoot.userData.frameTarget = model;
    const animationStartPoint = gltf.animations[0]
      ? getAnimationStartPoint(model, gltf.animations[0])
      : null;
    const followTarget = findModelFollowTarget(model);
    modelRoot.userData.followTarget = followTarget ?? model;

    if (gltf.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(model);
      const clip = gltf.animations[0];
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.reset();
      action.play();

      const setAnimationTime = (time) => {
        const duration = clip.duration || 1;
        const wrappedTime = ((time % duration) + duration) % duration;

        mixer.setTime(wrappedTime);
        model.updateMatrixWorld(true);
      };

      setAnimationTime(0);
      modelRoot.userData.mixer = mixer;
      modelRoot.userData.animation = {
        mixer,
        action,
        clip,
        duration: clip.duration,
        setTime: setAnimationTime,
      };
    }

    return {
      gltf,
      model,
      animations: gltf.animations,
      animationStartPoint,
      followTarget,
      animation: modelRoot.userData.animation ?? null,
    };
  });

  modelRoot.userData.ready = modelReady;

  return {
    modelRoot,
    modelReady,
  };
}

function prepareModel(model) {
  model.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) {
      return;
    }

    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = false;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => {
      material.needsUpdate = true;
    });
  });
}

function centerGymOnAnimationStart(gymRoot, floorRoot, startPoint) {
  floorRoot.position.x = startPoint.x;
  floorRoot.position.z = startPoint.z;
  gymRoot.position.x = -startPoint.x;
  gymRoot.position.z = -startPoint.z;
  gymRoot.updateMatrixWorld(true);
}

function getAnimationStartPoint(model, clip) {
  const rootPositionTrack = findRootPositionTrack(clip);

  if (!rootPositionTrack) {
    return null;
  }

  const targetName = rootPositionTrack.name.slice(0, rootPositionTrack.name.lastIndexOf('.'));
  const target = model.getObjectByName(targetName);

  if (!target) {
    return null;
  }

  const originalPosition = target.position.clone();

  target.position.fromArray(rootPositionTrack.values, 0);
  target.updateMatrixWorld(true);
  model.updateMatrixWorld(true);

  const startPoint = target.getWorldPosition(new THREE.Vector3());

  target.position.copy(originalPosition);
  target.updateMatrixWorld(true);
  model.updateMatrixWorld(true);

  return startPoint;
}

function findRootPositionTrack(clip) {
  return clip.tracks.find((track) => track.name.includes('Hips') && track.name.endsWith('.position'));
}

function findModelFollowTarget(model) {
  return model.getObjectByName('mixamorigHips')
    ?? model.getObjectByName('mixamorig:Hips')
    ?? model;
}

function fitModelToFloor(model, targetHeight) {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = targetHeight > 0 && size.y > 0 ? targetHeight / size.y : 1;

  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);

  const fittedBounds = new THREE.Box3().setFromObject(model);
  const center = fittedBounds.getCenter(new THREE.Vector3());

  model.position.x -= center.x;
  model.position.y -= fittedBounds.min.y;
  model.position.z -= center.z;
}

function followCameraOnXZ(object, snapSize) {
  object.onBeforeRender = (_renderer, _scene, camera) => {
    const parent = object.parent;
    const target = camera.getWorldPosition(new THREE.Vector3());
    const localTarget = parent ? parent.worldToLocal(target) : target;
    const step = Math.max(snapSize, 0.001);

    object.position.x = Math.round(localTarget.x / step) * step;
    object.position.z = Math.round(localTarget.z / step) * step;
  };
}

function toVector3(value) {
  if (value?.isVector3) {
    return value;
  }

  if (Array.isArray(value)) {
    return new THREE.Vector3(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  }

  return new THREE.Vector3(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}
