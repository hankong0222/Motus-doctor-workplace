import { createGymEnvironment } from '../three/gym.js';
import { createThreeScene } from '../three/scene.js';
import * as THREE from 'three';

const canvas = document.querySelector('#gym-canvas');
const status = document.querySelector('#scene-status');

const three = createThreeScene(canvas);
const gym = createGymEnvironment();
const followTargetPosition = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const nextTarget = new THREE.Vector3();
const targetDelta = new THREE.Vector3();
const cameraOffset = new THREE.Vector3(3.4, 1.85, 5.2);
let followTarget = null;

three.scene.add(gym.lightRig, gym.gridFloor);
three.start(({ delta }) => {
  if (!followTarget) {
    return;
  }

  followTarget.getWorldPosition(followTargetPosition);
  desiredTarget.set(followTargetPosition.x, 1.35, followTargetPosition.z);

  const alpha = 1 - Math.exp(-delta * 5.5);
  nextTarget.copy(three.controls.target).lerp(desiredTarget, alpha);
  targetDelta.subVectors(nextTarget, three.controls.target);
  three.controls.target.copy(nextTarget);
  three.camera.position.add(targetDelta);
});

gym.modelReady
  .then((result) => {
    if (result?.model) {
      followTarget = result.followTarget ?? gym.modelRoot.userData.followTarget ?? result.model;
      followTarget.getWorldPosition(followTargetPosition);
      three.controls.target.set(followTargetPosition.x, 1.35, followTargetPosition.z);
      three.camera.position.copy(three.controls.target).add(cameraOffset);
      three.controls.update();
    }

    status.textContent = 'Ready';
  })
  .catch((error) => {
    console.error(error);
    status.textContent = 'Model failed';
  });
