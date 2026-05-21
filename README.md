# Motus-doctor-workplace

## Run

```powershell
npm install
npm run dev
```

Then open `http://127.0.0.1:5188/`.

```js
import * as THREE from 'three';
import { createThreeScene } from './three/scene.js';
import { createGymEnvironment } from './three/gym.js';

const canvas = document.querySelector('canvas');
const three = createThreeScene(canvas);
const gym = createGymEnvironment();
const cameraOffset = new THREE.Vector3(3.4, 1.85, 5.2);
const nextTarget = new THREE.Vector3();
const targetDelta = new THREE.Vector3();
let followTarget = null;

three.scene.add(gym.lightRig, gym.gridFloor);
gym.modelReady.then((result) => {
  if (result?.model) {
    followTarget = result.followTarget ?? result.model;
  }
});

three.start(({ delta }) => {
  if (!followTarget) return;

  const position = followTarget.getWorldPosition(new THREE.Vector3());
  const target = new THREE.Vector3(position.x, 1.35, position.z);
  const alpha = 1 - Math.exp(-delta * 5.5);

  nextTarget.copy(three.controls.target).lerp(target, alpha);
  targetDelta.subVectors(nextTarget, three.controls.target);
  three.controls.target.copy(nextTarget);
  three.camera.position.add(targetDelta);
});
```
