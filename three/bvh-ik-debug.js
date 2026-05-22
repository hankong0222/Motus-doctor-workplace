import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

export const DEFAULT_BVH_URL = '/asset/cJM4ngRqXg83-m9THA1iEvbnr.bvh';

const DEFAULT_BVH_SCALE = 0.01;
const FOOT_CONTACT_THRESHOLD = 0.105;
const FOOT_GROUND_PERCENTILE = 0.08;
const EPSILON = 0.000001;
const SKELETON_OVERLAY_COLOR = 0xfff176;
const AXIS_COLORS = {
  x: 0xff4d4d,
  y: 0x58d86f,
  z: 0x4d8dff,
};

const ANATOMICAL_GIZMO_DEFINITIONS = [
  { id: 'pelvis', label: 'Pelvis', length: 0.26, labels: { x: 'LR', y: 'Up', z: 'Fwd' } },
  { id: 'leftFemur', label: 'L femur', length: 0.2 },
  { id: 'leftTibia', label: 'L tibia', length: 0.2 },
  { id: 'leftFoot', label: 'L foot', length: 0.18, labels: { x: 'roll', y: 'normal', z: 'toe' } },
  { id: 'rightFemur', label: 'R femur', length: 0.2 },
  { id: 'rightTibia', label: 'R tibia', length: 0.2 },
  { id: 'rightFoot', label: 'R foot', length: 0.18, labels: { x: 'roll', y: 'normal', z: 'toe' } },
];

const JOINT_ANGLE_ARC_SEGMENTS = 32;
const JOINT_ANGLE_ARC_DEFINITIONS = [
  { id: 'leftHipFlexion', side: 'left', joint: 'hip', type: 'flexion', color: 0x4dd2ff, radiusScale: 0.24 },
  { id: 'leftKneeFlexion', side: 'left', joint: 'knee', type: 'flexion', color: 0x69a7ff, radiusScale: 0.32 },
  { id: 'leftAnkleFlexion', side: 'left', joint: 'ankle', type: 'flexion', color: 0x85f06c, radiusScale: 0.34 },
  { id: 'rightHipFlexion', side: 'right', joint: 'hip', type: 'flexion', color: 0xff9f80, radiusScale: 0.24 },
  { id: 'rightKneeFlexion', side: 'right', joint: 'knee', type: 'flexion', color: 0xff6b6b, radiusScale: 0.32 },
  { id: 'rightAnkleFlexion', side: 'right', joint: 'ankle', type: 'flexion', color: 0xffd166, radiusScale: 0.34 },
  { id: 'pelvisRotation', joint: 'pelvis', type: 'rotation', color: 0xb78cff, radiusScale: 0.36 },
];

const AXIS_TRAIL_SMOOTHING = 3;
const AXIS_TRAIL_REPLAY_RESET_FRAME_GAP = 5;
const AXIS_TRAIL_DEFINITIONS = [
  { id: 'pelvisForward', frameId: 'pelvis', axis: 'z', color: 0x4d8dff, scale: 0.42, maxPoints: 2400, minDistance: 0.003, radius: 0.018 },
  { id: 'leftFootForward', frameId: 'leftFoot', axis: 'z', color: 0x85f06c, scale: 0.22, maxPoints: 2400, minDistance: 0.003, radius: 0.014 },
  { id: 'rightFootForward', frameId: 'rightFoot', axis: 'z', color: 0xffd166, scale: 0.22, maxPoints: 2400, minDistance: 0.003, radius: 0.014 },
];

const GAIT_SIDES = [
  {
    id: 'left',
    label: 'Left',
    hip: 'LeftUpLeg',
    knee: 'LeftLeg',
    ankle: 'LeftFoot',
    toe: 'LeftToeBase',
  },
  {
    id: 'right',
    label: 'Right',
    hip: 'RightUpLeg',
    knee: 'RightLeg',
    ankle: 'RightFoot',
    toe: 'RightToeBase',
  },
];

const ANATOMICAL_FRAME_SIDES = [
  {
    id: 'left',
    hip: 'LeftUpLeg',
    knee: 'LeftLeg',
    ankle: 'LeftFoot',
    toe: 'LeftToeBase',
  },
  {
    id: 'right',
    hip: 'RightUpLeg',
    knee: 'RightLeg',
    ankle: 'RightFoot',
    toe: 'RightToeBase',
  },
];

const IK_CHAINS = [
  {
    id: 'leftArm',
    targetId: 'leftHand',
    poleId: 'leftElbow',
    targetLabel: 'L hand',
    poleLabel: 'L elbow pole',
    root: 'LeftArm',
    mid: 'LeftForeArm',
    end: 'LeftHand',
    color: 0x4dd2ff,
    poleColor: 0xffd166,
  },
  {
    id: 'rightArm',
    targetId: 'rightHand',
    poleId: 'rightElbow',
    targetLabel: 'R hand',
    poleLabel: 'R elbow pole',
    root: 'RightArm',
    mid: 'RightForeArm',
    end: 'RightHand',
    color: 0x7cff9b,
    poleColor: 0xff9f1c,
  },
  {
    id: 'leftLeg',
    targetId: 'leftFoot',
    poleId: 'leftKnee',
    targetLabel: 'L foot',
    poleLabel: 'L knee pole',
    root: 'LeftUpLeg',
    mid: 'LeftLeg',
    end: 'LeftFoot',
    toe: 'LeftToeBase',
    color: 0x69a7ff,
    poleColor: 0xf5a3ff,
    contact: true,
  },
  {
    id: 'rightLeg',
    targetId: 'rightFoot',
    poleId: 'rightKnee',
    targetLabel: 'R foot',
    poleLabel: 'R knee pole',
    root: 'RightUpLeg',
    mid: 'RightLeg',
    end: 'RightFoot',
    toe: 'RightToeBase',
    color: 0xff6b6b,
    poleColor: 0xcad94a,
    contact: true,
  },
];

export function createBvhIkDebug({
  url = DEFAULT_BVH_URL,
  scale = DEFAULT_BVH_SCALE,
  showSkeleton = false,
  showIkHelpers = false,
  showAxisGizmos = false,
  showAngleArcs = false,
  showAxisTrails = false,
  showVisuals = false,
} = {}) {
  const root = new THREE.Group();
  const skeletonRoot = new THREE.Group();
  const overlayRoot = new THREE.Group();

  root.name = 'BVH IK Debug';
  const visualOptions = {
    showSkeleton: showVisuals || showSkeleton,
    showIkHelpers: showVisuals || showIkHelpers,
    showAxisGizmos: showVisuals || showAxisGizmos,
    showAngleArcs: showVisuals || showAngleArcs,
    showAxisTrails: showVisuals || showAxisTrails,
  };

  root.visible = visualOptions.showSkeleton
    || visualOptions.showIkHelpers
    || visualOptions.showAxisGizmos
    || visualOptions.showAngleArcs
    || visualOptions.showAxisTrails;
  skeletonRoot.name = 'BVH calculation source';
  skeletonRoot.scale.setScalar(scale);
  overlayRoot.name = 'IK target debug overlay';

  root.add(skeletonRoot, overlayRoot);

  const ready = loadBvhIkDebug({
    url,
    root,
    skeletonRoot,
    overlayRoot,
    visualOptions,
  });
  root.userData.ready = ready;

  return {
    root,
    ready,
  };
}

async function loadBvhIkDebug({ url, root, skeletonRoot, overlayRoot, visualOptions }) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load BVH: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const loader = new BVHLoader();
  const parsed = loader.parse(text);
  const { skeleton, clip } = parsed;
  const rootBone = skeleton.bones[0];

  sanitizeBvhAnimationNames(skeleton, clip);
  skeletonRoot.add(rootBone);
  rootBone.updateMatrixWorld(true);

  const mixer = new THREE.AnimationMixer(rootBone);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.reset();
  action.play();
  mixer.setTime(0);
  root.updateMatrixWorld(true);

  const metadata = parseBvhMetadata(text, skeleton, clip, url);
  const channelData = parseBvhChannelData(text, metadata.frames);
  const boneMap = createBoneMap(skeleton.bones);
  const chains = IK_CHAINS
    .map((definition) => resolveIkChain(definition, boneMap))
    .filter(Boolean);
  const helpers = visualOptions.showIkHelpers ? createIkHelpers(overlayRoot, chains) : createEmptyIkHelpers();
  const skeletonVisual = visualOptions.showSkeleton
    ? createSkeletonLineOverlay(overlayRoot, skeleton.bones)
    : createEmptySkeletonVisual();
  const frameGizmos = visualOptions.showAxisGizmos
    ? createAnatomicalFrameGizmos(overlayRoot)
    : createEmptyFrameGizmos();
  const angleArcs = visualOptions.showAngleArcs
    ? createJointAngleArcs(overlayRoot)
    : createEmptyAngleArcs();
  const axisTrails = visualOptions.showAxisTrails
    ? createAxisTrails(overlayRoot, metadata)
    : createEmptyAxisTrails();

  alignSkeletonRoot(skeletonRoot, rootBone, skeleton.bones);
  root.updateMatrixWorld(true);

  const contactBaselines = computeContactBaselines({
    metadata,
    mixer,
    root,
    chains,
  });
  let currentFrame = null;
  const setTime = (time, { updateVisuals = true } = {}) => {
    const clipTime = wrapClipTime(time, clip.duration, metadata.frameTime);

    mixer.setTime(clipTime);
    root.updateMatrixWorld(true);

    currentFrame = sampleIkFrame({
      time: clipTime,
      metadata,
      rootBone,
      bones: skeleton.bones,
      boneMap,
      channelData,
      contactBaselines,
      chains,
    });
    if (updateVisuals) {
      updateIkHelpers(helpers, currentFrame, root);
      updateSkeletonLineOverlay(skeletonVisual, root);
      updateAnatomicalFrameGizmos(frameGizmos, currentFrame, root);
      updateJointAngleArcs(angleArcs, currentFrame, root);
      updateAxisTrails(axisTrails, currentFrame, root);
    }
    return currentFrame;
  };

  currentFrame = setTime(0);

  const refreshRootVisibility = () => {
    root.visible = skeletonVisual.enabled
      || helpers.enabled
      || frameGizmos.enabled
      || angleArcs.enabled
      || axisTrails.enabled;
  };

  return {
    action,
    clip,
    mixer,
    skeleton,
    rootBone,
    metadata,
    contactBaselines,
    channelData,
    chains,
    setReferenceModel: (model) => {
      setSkeletonReferenceModel(skeletonVisual, model);
      setIkReferenceModel(helpers, model);
      setFrameGizmoReferenceModel(frameGizmos, model);
      setAngleArcReferenceModel(angleArcs, model);
      setAxisTrailReferenceModel(axisTrails, model);
      updateSkeletonLineOverlay(skeletonVisual, root);
      updateAnatomicalFrameGizmos(frameGizmos, currentFrame, root);
      updateJointAngleArcs(angleArcs, currentFrame, root);
      updateAxisTrails(axisTrails, currentFrame, root);
    },
    setSkeletonVisible: (visible) => {
      skeletonVisual.enabled = Boolean(visible);
      if (skeletonVisual.line) {
        skeletonVisual.line.visible = skeletonVisual.enabled;
      }
      refreshRootVisibility();
    },
    setBodyAxisVisible: (visible) => {
      const enabled = Boolean(visible);

      setFrameGizmosVisible(frameGizmos, enabled);
      setAngleArcsVisible(angleArcs, enabled);
      setAxisTrailsVisible(axisTrails, enabled);

      if (enabled) {
        updateAnatomicalFrameGizmos(frameGizmos, currentFrame, root);
        updateJointAngleArcs(angleArcs, currentFrame, root);
        updateAxisTrails(axisTrails, currentFrame, root);
      }

      refreshRootVisibility();
    },
    getVisualState: () => ({
      skeletonEnabled: skeletonVisual.enabled,
      frameGizmosEnabled: frameGizmos.enabled,
      angleArcsEnabled: angleArcs.enabled,
      axisTrailsEnabled: axisTrails.enabled,
      bodyAxisEnabled: frameGizmos.enabled || angleArcs.enabled || axisTrails.enabled,
      skeletonSegments: skeletonVisual.segments.length,
      glbAlignedSegments: skeletonVisual.segments.filter(
        (segment) => segment.referenceBone && segment.referenceParentBone,
      ).length,
    }),
    setTime,
    buildAnalysisFrames: () => buildAnalysisFrames({
      metadata,
      contactBaselines,
      setTime,
      getRestoreTime: () => currentFrame?.time ?? 0,
    }),
    buildAnalysisCsv: () => buildAnalysisCsv(buildAnalysisFrames({
      metadata,
      contactBaselines,
      setTime,
      getRestoreTime: () => currentFrame?.time ?? 0,
    })),
    getCurrentFrame: () => currentFrame,
  };
}

function parseBvhMetadata(text, skeleton, clip, url) {
  const framesMatch = text.match(/^\s*Frames:\s*(\d+)/im);
  const frameTimeMatch = text.match(/^\s*Frame Time:\s*([0-9.eE+-]+)/im);
  const frames = framesMatch ? Number(framesMatch[1]) : Math.max(1, Math.round(clip.duration * 30) + 1);
  const frameTime = frameTimeMatch ? Number(frameTimeMatch[1]) : 1 / 30;
  const channelCount = Array.from(text.matchAll(/^\s*CHANNELS\s+(\d+)/gim))
    .reduce((total, match) => total + Number(match[1]), 0);

  return {
    url,
    bones: skeleton.bones.length,
    channels: channelCount,
    duration: clip.duration,
    frames,
    frameTime,
    sampleRate: frameTime > 0 ? 1 / frameTime : 0,
  };
}

function parseBvhChannelData(text, frameCount) {
  const lines = text.split(/[\r\n]+/g);
  const nodes = [];
  let activeNode = null;
  let motionIndex = -1;
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line === 'MOTION') {
      motionIndex = index;
      break;
    }

    const nodeMatch = line.match(/^(ROOT|JOINT)\s+(\S+)/i);
    if (nodeMatch) {
      activeNode = {
        name: nodeMatch[2],
        shortName: stripNamespace(nodeMatch[2]),
        channels: [],
        offset: 0,
      };
      nodes.push(activeNode);
      continue;
    }

    const channelMatch = line.match(/^CHANNELS\s+(\d+)\s+(.+)$/i);
    if (channelMatch && activeNode) {
      const count = Number(channelMatch[1]);
      activeNode.channels = channelMatch[2].trim().split(/\s+/).slice(0, count);
      activeNode.offset = offset;
      offset += activeNode.channels.length;
    }
  }

  const frames = [];

  if (motionIndex >= 0) {
    const firstFrameLine = motionIndex + 3;

    for (let index = firstFrameLine; index < lines.length && frames.length < frameCount; index += 1) {
      const line = lines[index].trim();

      if (line.length === 0) {
        continue;
      }

      frames.push(line.split(/\s+/).map(Number));
    }
  }

  return {
    nodes,
    frames,
    channelCount: offset,
  };
}

function createBoneMap(bones) {
  const map = new Map();

  bones.forEach((bone) => {
    const originalName = bone.userData.bvhName ?? bone.name;

    map.set(bone.name, bone);
    map.set(originalName, bone);
    map.set(stripNamespace(bone.name), bone);
    map.set(stripNamespace(originalName), bone);
  });

  return map;
}

function sanitizeBvhAnimationNames(skeleton, clip) {
  const nameMap = new Map();

  skeleton.bones.forEach((bone) => {
    const originalName = bone.name;
    const safeName = THREE.PropertyBinding.sanitizeNodeName(originalName);

    bone.userData.bvhName = originalName;
    bone.name = safeName;
    nameMap.set(originalName, safeName);
  });

  clip.tracks.forEach((track) => {
    const dotIndex = track.name.lastIndexOf('.');

    if (dotIndex < 0) {
      return;
    }

    const nodeName = track.name.slice(0, dotIndex);
    const propertyName = track.name.slice(dotIndex + 1);
    const safeName = nameMap.get(nodeName) ?? THREE.PropertyBinding.sanitizeNodeName(nodeName);

    track.name = `${safeName}.${propertyName}`;
  });
}

function resolveIkChain(definition, boneMap) {
  const root = boneMap.get(definition.root);
  const mid = boneMap.get(definition.mid);
  const end = boneMap.get(definition.end);

  if (!root || !mid || !end) {
    console.warn('BVH IK chain missing bones:', definition.id);
    return null;
  }

  return {
    ...definition,
    rootBone: root,
    midBone: mid,
    endBone: end,
    toeBone: definition.toe ? boneMap.get(definition.toe) ?? null : null,
  };
}

function createSkeletonHelper(rootBone) {
  const helper = new THREE.SkeletonHelper(rootBone);
  helper.name = 'BVH source skeleton';
  helper.material.color.setHex(0xbdddc7);
  helper.material.opacity = 0.38;
  helper.material.transparent = true;
  helper.material.depthTest = false;
  helper.renderOrder = 30;
  helper.frustumCulled = false;
  return helper;
}

function alignSkeletonRoot(skeletonRoot, rootBone, bones) {
  const rootPosition = rootBone.getWorldPosition(new THREE.Vector3());
  const minY = bones.reduce((lowest, bone) => {
    const position = bone.getWorldPosition(new THREE.Vector3());
    return Math.min(lowest, position.y);
  }, Infinity);

  skeletonRoot.position.x -= rootPosition.x;
  skeletonRoot.position.y -= Number.isFinite(minY) ? minY : 0;
  skeletonRoot.position.z -= rootPosition.z;
}

function sampleIkFrame({
  time,
  metadata,
  rootBone,
  bones,
  boneMap,
  channelData,
  contactBaselines,
  chains,
}) {
  const frameIndex = clamp(
    Math.round(time / metadata.frameTime),
    0,
    Math.max(metadata.frames - 1, 0),
  );
  const root = sampleBoneTransform(rootBone);
  const targets = {};
  const poles = {};
  const gaitAngles = sampleGaitAngles(boneMap, contactBaselines);
  const anatomical = sampleAnatomicalCoordinateSystem(boneMap);
  const jointRotations = sampleLocalJointRotations(bones);
  const bvhChannels = sampleBvhChannels(channelData, frameIndex);

  chains.forEach((chain) => {
    const rootTransform = sampleBoneTransform(chain.rootBone);
    const midTransform = sampleBoneTransform(chain.midBone);
    const endTransform = sampleBoneTransform(chain.endBone);
    const toeTransform = chain.toeBone ? sampleBoneTransform(chain.toeBone) : null;
    const pole = computePoleTransform(rootTransform.position, midTransform.position, endTransform.position);

    targets[chain.targetId] = {
      chainId: chain.id,
      label: chain.targetLabel,
      position: endTransform.position,
      rotation: endTransform.rotation,
      euler: endTransform.euler,
      rootPosition: rootTransform.position,
      midPosition: midTransform.position,
      toePosition: toeTransform?.position ?? null,
      toeDirection: toeTransform
        ? toeTransform.position.clone().sub(endTransform.position).normalize()
        : null,
      contact: chain.contact
        ? isFootInContact(
          endTransform.position,
          toeTransform?.position ?? null,
          contactBaselines[chain.targetId],
        )
        : null,
    };

    poles[chain.poleId] = {
      chainId: chain.id,
      label: chain.poleLabel,
      position: pole.position,
      direction: pole.direction,
      rootPosition: rootTransform.position,
      midPosition: midTransform.position,
      endPosition: endTransform.position,
    };
  });

  return {
    frameIndex,
    frameCount: metadata.frames,
    time,
    root,
    targets,
    poles,
    gaitAngles,
    anatomicalLandmarks: anatomical.landmarks,
    anatomicalFrames: anatomical.frames,
    anatomicalJointAngles: anatomical.jointAngles,
    jointRotations,
    bvhChannels,
    contactBaselines,
    metadata,
  };
}

function sampleBoneTransform(bone) {
  const position = bone.getWorldPosition(new THREE.Vector3());
  const rotation = bone.getWorldQuaternion(new THREE.Quaternion());
  const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');

  return {
    position,
    rotation,
    euler,
  };
}

function computePoleTransform(rootPosition, midPosition, endPosition) {
  const rootToEnd = endPosition.clone().sub(rootPosition);
  const rootToMid = midPosition.clone().sub(rootPosition);
  let direction = new THREE.Vector3(0, 0, 1);

  if (rootToEnd.lengthSq() > EPSILON) {
    const projectionScale = rootToMid.dot(rootToEnd) / rootToEnd.lengthSq();
    const projectedMid = rootPosition.clone().add(rootToEnd.multiplyScalar(projectionScale));
    direction = midPosition.clone().sub(projectedMid);

    if (direction.lengthSq() <= EPSILON) {
      direction.set(0, 0, 1);
    }
  }

  direction.normalize();

  const chainLength = rootPosition.distanceTo(midPosition) + midPosition.distanceTo(endPosition);
  const poleDistance = Math.max(chainLength * 0.55, 0.28);

  return {
    position: midPosition.clone().add(direction.clone().multiplyScalar(poleDistance)),
    direction,
  };
}

function sampleGaitAngles(boneMap, contactBaselines) {
  const pelvis = sampleOptionalPosition(boneMap.get('Hips'));
  const spine = sampleOptionalPosition(boneMap.get('Spine'));
  const trunk = pelvis && spine ? spine.clone().sub(pelvis) : new THREE.Vector3(0, 1, 0);
  const sides = {};

  GAIT_SIDES.forEach((side) => {
    const hip = sampleOptionalPosition(boneMap.get(side.hip));
    const knee = sampleOptionalPosition(boneMap.get(side.knee));
    const ankle = sampleOptionalPosition(boneMap.get(side.ankle));
    const toe = sampleOptionalPosition(boneMap.get(side.toe));

    if (!hip || !knee || !ankle) {
      sides[side.id] = null;
      return;
    }

    const hipIncluded = angleBetweenDeg(trunk, knee.clone().sub(hip));
    const kneeIncluded = jointAngleDeg(hip, knee, ankle);
    const ankleIncluded = toe ? jointAngleDeg(knee, ankle, toe) : null;
    const footPitch = toe ? footPitchDeg(ankle, toe) : null;

    sides[side.id] = {
      label: side.label,
      hipFlexionDeg: roundAngle(180 - hipIncluded),
      hipIncludedDeg: roundAngle(hipIncluded),
      kneeFlexionDeg: roundAngle(180 - kneeIncluded),
      kneeIncludedDeg: roundAngle(kneeIncluded),
      ankleIncludedDeg: ankleIncluded === null ? null : roundAngle(ankleIncluded),
      footPitchDeg: footPitch === null ? null : roundAngle(footPitch),
      contact: isFootInContact(ankle, toe, contactBaselines[`${side.id}Foot`]),
    };
  });

  return sides;
}

function sampleAnatomicalCoordinateSystem(boneMap) {
  const landmarks = createAnatomicalLandmarks(boneMap);
  const pelvis = createPelvisFrame(landmarks);
  const frames = { pelvis };
  const jointAngles = {};

  ANATOMICAL_FRAME_SIDES.forEach((side) => {
    frames[`${side.id}Femur`] = createFemurFrame(side.id, landmarks, pelvis);
    frames[`${side.id}Tibia`] = createTibiaFrame(side.id, landmarks, pelvis);
    frames[`${side.id}Foot`] = createFootFrame(side.id, landmarks, pelvis);

    jointAngles[side.id] = {
      hip: calculateAnatomicalJointAngles(pelvis, frames[`${side.id}Femur`]),
      knee: calculateAnatomicalJointAngles(frames[`${side.id}Femur`], frames[`${side.id}Tibia`]),
      ankle: calculateAnatomicalJointAngles(frames[`${side.id}Tibia`], frames[`${side.id}Foot`]),
    };
  });

  return {
    landmarks,
    frames,
    jointAngles,
  };
}

function createAnatomicalLandmarks(boneMap) {
  const landmarks = {
    pelvis: sampleOptionalPosition(boneMap.get('Hips')),
    spine: sampleOptionalPosition(boneMap.get('Spine')),
  };

  ANATOMICAL_FRAME_SIDES.forEach((side) => {
    landmarks[`${side.id}Hip`] = sampleOptionalPosition(boneMap.get(side.hip));
    landmarks[`${side.id}Knee`] = sampleOptionalPosition(boneMap.get(side.knee));
    landmarks[`${side.id}Ankle`] = sampleOptionalPosition(boneMap.get(side.ankle));
    landmarks[`${side.id}Toe`] = sampleOptionalPosition(boneMap.get(side.toe));
  });

  return landmarks;
}

// BVH has joint centers, not bony landmarks such as ASIS, epicondyles, or malleoli.
// These frames are joint-center anatomical approximations for gait-debug analysis.
export function createPelvisFrame(landmarks) {
  const origin = landmarks.pelvis;
  const leftHip = landmarks.leftHip;
  const rightHip = landmarks.rightHip;
  const spine = landmarks.spine;

  if (!origin || !leftHip || !rightHip || !spine) {
    return null;
  }

  const rightAxisHint = rightHip.clone().sub(leftHip);
  const superiorAxisHint = spine.clone().sub(origin);

  return createFrameFromXY('pelvis', origin, rightAxisHint, superiorAxisHint);
}

export function createFemurFrame(side, landmarks, pelvisFrame) {
  const hip = landmarks[`${side}Hip`];
  const knee = landmarks[`${side}Knee`];

  if (!hip || !knee || !pelvisFrame) {
    return null;
  }

  return createFrameFromXY(
    `${side}Femur`,
    hip,
    pelvisFrame.axes.x,
    hip.clone().sub(knee),
  );
}

export function createTibiaFrame(side, landmarks, pelvisFrame) {
  const knee = landmarks[`${side}Knee`];
  const ankle = landmarks[`${side}Ankle`];

  if (!knee || !ankle || !pelvisFrame) {
    return null;
  }

  return createFrameFromXY(
    `${side}Tibia`,
    knee,
    pelvisFrame.axes.x,
    knee.clone().sub(ankle),
  );
}

export function createFootFrame(side, landmarks, pelvisFrame) {
  const ankle = landmarks[`${side}Ankle`];
  const toe = landmarks[`${side}Toe`];

  if (!ankle || !toe || !pelvisFrame) {
    return null;
  }

  return createFrameFromXZ(
    `${side}Foot`,
    ankle,
    pelvisFrame.axes.x,
    toe.clone().sub(ankle),
  );
}

export function calculateAnatomicalJointAngles(proximalFrame, distalFrame) {
  if (!proximalFrame || !distalFrame) {
    return null;
  }

  const relative = proximalFrame.quaternion.clone().invert().multiply(distalFrame.quaternion).normalize();
  const euler = new THREE.Euler().setFromQuaternion(relative, 'XYZ');
  const rawEulerXYZDeg = {
    x: roundAngle(THREE.MathUtils.radToDeg(euler.x)),
    y: roundAngle(THREE.MathUtils.radToDeg(euler.y)),
    z: roundAngle(THREE.MathUtils.radToDeg(euler.z)),
  };

  return {
    flexionExtensionDeg: rawEulerXYZDeg.x,
    abductionAdductionDeg: rawEulerXYZDeg.z,
    internalExternalRotationDeg: rawEulerXYZDeg.y,
    rawEulerXYZDeg,
  };
}

function createFrameFromXY(id, origin, xHint, yHint) {
  const y = safeNormalize(yHint, new THREE.Vector3(0, 1, 0));
  let x = rejectVector(xHint, y);

  if (x.lengthSq() <= EPSILON) {
    x = choosePerpendicular(y);
  }

  x.normalize();

  const z = x.clone().cross(y).normalize();
  x.copy(y.clone().cross(z).normalize());

  return createAnatomicalFrame(id, origin, x, y, z);
}

function createFrameFromXZ(id, origin, xHint, zHint) {
  const z = safeNormalize(zHint, new THREE.Vector3(0, 0, 1));
  let x = rejectVector(xHint, z);

  if (x.lengthSq() <= EPSILON) {
    x = choosePerpendicular(z);
  }

  x.normalize();

  const y = z.clone().cross(x).normalize();
  const correctedZ = x.clone().cross(y).normalize();

  return createAnatomicalFrame(id, origin, x, y, correctedZ);
}

function createAnatomicalFrame(id, origin, xAxis, yAxis, zAxis) {
  const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);

  return {
    id,
    origin: origin.clone(),
    axes: {
      x: xAxis.clone(),
      y: yAxis.clone(),
      z: zAxis.clone(),
    },
    quaternion,
  };
}

function rejectVector(vector, normal) {
  return vector.clone().sub(normal.clone().multiplyScalar(vector.dot(normal)));
}

function safeNormalize(vector, fallback) {
  return vector.lengthSq() > EPSILON ? vector.clone().normalize() : fallback.clone();
}

function choosePerpendicular(axis) {
  const candidate = Math.abs(axis.dot(new THREE.Vector3(1, 0, 0))) < 0.85
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 0, 1);

  return rejectVector(candidate, axis).normalize();
}

function sampleLocalJointRotations(bones) {
  const rotations = {};

  bones.forEach((bone) => {
    const euler = new THREE.Euler().setFromQuaternion(bone.quaternion, 'XYZ');
    const originalName = bone.userData.bvhName ?? bone.name;

    rotations[stripNamespace(originalName)] = {
      name: originalName,
      eulerDeg: {
        x: roundAngle(THREE.MathUtils.radToDeg(euler.x)),
        y: roundAngle(THREE.MathUtils.radToDeg(euler.y)),
        z: roundAngle(THREE.MathUtils.radToDeg(euler.z)),
      },
      quaternion: {
        x: roundUnit(bone.quaternion.x),
        y: roundUnit(bone.quaternion.y),
        z: roundUnit(bone.quaternion.z),
        w: roundUnit(bone.quaternion.w),
      },
    };
  });

  return rotations;
}

function sampleBvhChannels(channelData, frameIndex) {
  const values = channelData.frames[frameIndex];
  const joints = {};

  if (!values) {
    return joints;
  }

  channelData.nodes.forEach((node) => {
    const joint = {};

    node.channels.forEach((channel, index) => {
      const value = values[node.offset + index];

      if (Number.isFinite(value)) {
        joint[channel] = roundAngle(value);
      }
    });

    joints[node.shortName] = {
      name: node.name,
      channels: joint,
    };
  });

  return joints;
}

function sampleOptionalPosition(bone) {
  return bone ? bone.getWorldPosition(new THREE.Vector3()) : null;
}

function jointAngleDeg(a, b, c) {
  return angleBetweenDeg(a.clone().sub(b), c.clone().sub(b));
}

function angleBetweenDeg(a, b) {
  const denominator = Math.sqrt(a.lengthSq() * b.lengthSq());

  if (denominator <= EPSILON) {
    return 0;
  }

  const cosine = clamp(a.dot(b) / denominator, -1, 1);
  return THREE.MathUtils.radToDeg(Math.acos(cosine));
}

function footPitchDeg(ankle, toe) {
  const foot = toe.clone().sub(ankle);
  const horizontal = Math.sqrt(foot.x * foot.x + foot.z * foot.z);
  return THREE.MathUtils.radToDeg(Math.atan2(foot.y, horizontal));
}

function isFootInContact(footPosition, toePosition, baseline = 0) {
  const lowest = toePosition
    ? Math.min(footPosition.y, toePosition.y)
    : footPosition.y;

  return lowest <= baseline + FOOT_CONTACT_THRESHOLD;
}

function computeContactBaselines({ metadata, mixer, root, chains }) {
  const baselines = {};
  const lowSamples = {};

  chains.filter((chain) => chain.contact).forEach((chain) => {
    baselines[chain.targetId] = Infinity;
    lowSamples[chain.targetId] = [];
  });

  for (let frameIndex = 0; frameIndex < metadata.frames; frameIndex += 1) {
    mixer.setTime(frameIndex * metadata.frameTime);
    root.updateMatrixWorld(true);

    chains.filter((chain) => chain.contact).forEach((chain) => {
      const foot = chain.endBone.getWorldPosition(new THREE.Vector3());
      const toe = chain.toeBone?.getWorldPosition(new THREE.Vector3()) ?? null;
      const lowest = toe ? Math.min(foot.y, toe.y) : foot.y;

      baselines[chain.targetId] = Math.min(baselines[chain.targetId], lowest);
      lowSamples[chain.targetId].push(lowest);
    });
  }

  Object.keys(baselines).forEach((key) => {
    const robustGround = percentile(lowSamples[key], FOOT_GROUND_PERCENTILE);

    if (Number.isFinite(robustGround)) {
      baselines[key] = roundUnit(robustGround);
    } else if (!Number.isFinite(baselines[key])) {
      baselines[key] = 0;
    } else {
      baselines[key] = roundUnit(baselines[key]);
    }
  });

  return baselines;
}

function createEmptyIkHelpers() {
  return {
    enabled: false,
    chains: [],
    referenceMap: null,
    targets: new Map(),
    poles: new Map(),
    limbs: new Map(),
    poleLines: new Map(),
    toeLines: new Map(),
  };
}

function createEmptySkeletonVisual() {
  return {
    enabled: false,
    line: null,
    positions: null,
    segments: [],
    referenceMap: null,
  };
}

function createSkeletonLineOverlay(overlayRoot, bones) {
  const segments = bones
    .filter((bone) => bone.parent?.isBone)
    .map((bone) => ({
      bone,
      parentBone: bone.parent,
      referenceBone: null,
      referenceParentBone: null,
    }));
  const positions = new Float32Array(segments.length * 2 * 3);
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({
    color: SKELETON_OVERLAY_COLOR,
    depthTest: false,
    transparent: true,
    opacity: 0.92,
  });
  const line = new THREE.LineSegments(geometry, material);

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  line.name = 'BVH skeleton aligned to GLB';
  line.renderOrder = 70;
  line.frustumCulled = false;
  overlayRoot.add(line);

  return {
    enabled: true,
    line,
    positions,
    segments,
    referenceMap: null,
  };
}

function setSkeletonReferenceModel(skeletonVisual, model) {
  if (!skeletonVisual.line || !model) {
    return;
  }

  const referenceMap = createObjectMap(model);

  skeletonVisual.referenceMap = referenceMap;
  skeletonVisual.segments.forEach((segment) => {
    segment.referenceBone = referenceMap.get(segment.bone.name) ?? null;
    segment.referenceParentBone = referenceMap.get(segment.parentBone.name) ?? null;
  });
}

function updateSkeletonLineOverlay(skeletonVisual, root) {
  if (!skeletonVisual.enabled || !skeletonVisual.line) {
    return;
  }

  const sourcePosition = new THREE.Vector3();
  const targetPosition = new THREE.Vector3();

  skeletonVisual.segments.forEach((segment, index) => {
    const parentSource = segment.referenceParentBone ?? segment.parentBone;
    const childSource = segment.referenceBone ?? segment.bone;

    parentSource.getWorldPosition(sourcePosition);
    childSource.getWorldPosition(targetPosition);

    const parent = toRootLocal(root, sourcePosition);
    const child = toRootLocal(root, targetPosition);
    const offset = index * 6;

    skeletonVisual.positions[offset] = parent.x;
    skeletonVisual.positions[offset + 1] = parent.y;
    skeletonVisual.positions[offset + 2] = parent.z;
    skeletonVisual.positions[offset + 3] = child.x;
    skeletonVisual.positions[offset + 4] = child.y;
    skeletonVisual.positions[offset + 5] = child.z;
  });

  skeletonVisual.line.geometry.attributes.position.needsUpdate = true;
  skeletonVisual.line.geometry.computeBoundingSphere();
}

function createEmptyFrameGizmos() {
  return {
    enabled: false,
    gizmos: new Map(),
    referenceMap: null,
  };
}

function createAnatomicalFrameGizmos(overlayRoot) {
  const frameGizmos = {
    enabled: true,
    gizmos: new Map(),
    referenceMap: null,
  };

  ANATOMICAL_GIZMO_DEFINITIONS.forEach((definition) => {
    const gizmo = createAnatomicalFrameGizmo(definition);

    overlayRoot.add(gizmo.group);
    frameGizmos.gizmos.set(definition.id, gizmo);
  });

  return frameGizmos;
}

function createAnatomicalFrameGizmo(definition) {
  const group = new THREE.Group();
  const axes = {};

  group.name = `${definition.label} anatomical axis gizmo`;

  ['x', 'y', 'z'].forEach((axis) => {
    const line = createLine(AXIS_COLORS[axis], 2);
    const axisLabel = definition.labels?.[axis]
      ? createTextSprite(`${definition.label} ${definition.labels[axis]}`, AXIS_COLORS[axis], 22, 0.00155)
      : null;

    line.line.renderOrder = 80;
    group.add(line.line);

    if (axisLabel) {
      axisLabel.renderOrder = 90;
      group.add(axisLabel);
    }

    axes[axis] = {
      line,
      label: axisLabel,
    };
  });

  return {
    definition,
    group,
    axes,
  };
}

function setFrameGizmoReferenceModel(frameGizmos, model) {
  if (!frameGizmos.gizmos.size || !model) {
    return;
  }

  frameGizmos.referenceMap = createObjectMap(model);
}

function updateAnatomicalFrameGizmos(frameGizmos, frame, root) {
  if (!frameGizmos.enabled || !frame) {
    return;
  }

  const displayFrames = frameGizmos.referenceMap
    ? sampleAnatomicalCoordinateSystem(frameGizmos.referenceMap).frames
    : frame.anatomicalFrames;

  frameGizmos.gizmos.forEach((gizmo, id) => {
    const anatomicalFrame = displayFrames[id];

    gizmo.group.visible = Boolean(anatomicalFrame);

    if (!anatomicalFrame) {
      return;
    }

    updateAnatomicalFrameGizmo(gizmo, anatomicalFrame, root);
  });
}

function updateAnatomicalFrameGizmo(gizmo, anatomicalFrame, root) {
  const origin = toRootLocal(root, anatomicalFrame.origin);

  Object.entries(gizmo.axes).forEach(([axis, helper]) => {
    const worldEnd = anatomicalFrame.origin.clone().add(
      anatomicalFrame.axes[axis].clone().multiplyScalar(gizmo.definition.length),
    );
    const localEnd = toRootLocal(root, worldEnd);

    setLinePoints(helper.line, [origin, localEnd]);

    if (helper.label) {
      helper.label.position.copy(localEnd);
    }
  });
}

function setFrameGizmosVisible(frameGizmos, visible) {
  frameGizmos.enabled = Boolean(visible && frameGizmos.gizmos.size);

  if (!frameGizmos.enabled) {
    frameGizmos.gizmos.forEach((gizmo) => {
      gizmo.group.visible = false;
    });
  }
}

function createEmptyAxisTrails() {
  return {
    enabled: false,
    trails: new Map(),
    referenceMap: null,
  };
}

function createAxisTrails(overlayRoot, metadata) {
  const axisTrails = {
    enabled: true,
    trails: new Map(),
    referenceMap: null,
    lastFrameIndex: null,
  };

  AXIS_TRAIL_DEFINITIONS.forEach((definition) => {
    const trail = createAxisTrail({
      ...definition,
      maxPoints: Math.max(definition.maxPoints, metadata.frames),
    });

    overlayRoot.add(trail.group);
    axisTrails.trails.set(definition.id, trail);
  });

  return axisTrails;
}

function createAxisTrail(definition) {
  const group = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial({
    color: definition.color,
    depthTest: false,
    transparent: true,
    opacity: 0.78,
  });
  const mesh = new THREE.Mesh(geometry, material);

  group.name = `${definition.id} axis temporal trail`;
  mesh.renderOrder = 78;
  mesh.frustumCulled = false;
  group.add(mesh);

  return {
    definition,
    group,
    mesh,
    pointsByFrame: new Map(),
  };
}

function setAxisTrailReferenceModel(axisTrails, model) {
  if (!axisTrails.trails.size || !model) {
    return;
  }

  axisTrails.referenceMap = createObjectMap(model);
  clearAxisTrails(axisTrails);
}

function clearAxisTrails(axisTrails) {
  axisTrails.lastFrameIndex = null;

  axisTrails.trails.forEach((trail) => {
    trail.pointsByFrame.clear();
    trail.mesh.geometry.dispose();
    trail.mesh.geometry = new THREE.BufferGeometry();
  });
}

function setAxisTrailsVisible(axisTrails, visible) {
  axisTrails.enabled = Boolean(visible && axisTrails.trails.size);

  if (!axisTrails.enabled) {
    axisTrails.trails.forEach((trail) => {
      trail.group.visible = false;
    });
  }
}

function updateAxisTrails(axisTrails, frame, root) {
  if (!axisTrails.enabled || !frame) {
    return;
  }

  const displayFrames = axisTrails.referenceMap
    ? sampleAnatomicalCoordinateSystem(axisTrails.referenceMap).frames
    : frame.anatomicalFrames;

  if (shouldClearAxisTrailsForReplay(axisTrails, frame.frameIndex)) {
    clearAxisTrails(axisTrails);
  }

  axisTrails.lastFrameIndex = frame.frameIndex;

  axisTrails.trails.forEach((trail) => {
    const point = getAxisTrailPoint(trail.definition, displayFrames);

    if (!point) {
      trail.group.visible = false;
      return;
    }

    appendAxisTrailPoint(trail, point, frame.frameIndex, frame.frameCount);
    updateAxisTrailLine(trail, root);
  });
}

function shouldClearAxisTrailsForReplay(axisTrails, frameIndex) {
  return axisTrails.lastFrameIndex !== null
    && frameIndex + AXIS_TRAIL_REPLAY_RESET_FRAME_GAP < axisTrails.lastFrameIndex;
}

function getAxisTrailPoint(definition, frames) {
  const anatomicalFrame = frames?.[definition.frameId];
  const axis = anatomicalFrame?.axes?.[definition.axis];

  if (!anatomicalFrame || !axis) {
    return null;
  }

  return anatomicalFrame.origin.clone().add(axis.clone().multiplyScalar(definition.scale));
}

function appendAxisTrailPoint(trail, point, frameIndex, frameCount) {
  const previous = trail.pointsByFrame.get(frameIndex);

  if (previous && previous.distanceTo(point) < trail.definition.minDistance) {
    return;
  }

  trail.pointsByFrame.set(frameIndex, point.clone());

  while (trail.pointsByFrame.size > trail.definition.maxPoints) {
    const oldestKey = trail.pointsByFrame.keys().next().value;
    trail.pointsByFrame.delete(oldestKey);
  }
}

function updateAxisTrailLine(trail, root) {
  const points = getOrderedAxisTrailPoints(trail);

  if (points.length < 2) {
    trail.group.visible = false;
    return;
  }

  const smoothPoints = buildTrailSplinePoints(points)
    .map((point) => toRootLocal(root, point));

  trail.group.visible = true;
  setTrailTubeGeometry(trail, smoothPoints);
}

function getOrderedAxisTrailPoints(trail) {
  const orderedPoints = Array.from(trail.pointsByFrame.entries())
    .sort(([a], [b]) => a - b)
    .map(([, point]) => point);
  const filteredPoints = [];

  orderedPoints.forEach((point) => {
    const previous = filteredPoints.at(-1);

    if (!previous || previous.distanceTo(point) >= trail.definition.minDistance) {
      filteredPoints.push(point);
    }
  });

  return filteredPoints;
}

function buildTrailSplinePoints(points) {
  if (points.length < 3) {
    return points;
  }

  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.35);
  const renderPoints = Math.max(points.length * AXIS_TRAIL_SMOOTHING, points.length);

  return curve.getPoints(renderPoints - 1);
}

function setTrailTubeGeometry(trail, points) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.35);
  const tubularSegments = Math.max(points.length - 1, 2);
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, trail.definition.radius, 6, false);

  trail.mesh.geometry.dispose();
  trail.mesh.geometry = geometry;
}

function createEmptyAngleArcs() {
  return {
    enabled: false,
    arcs: new Map(),
    referenceMap: null,
  };
}

function createJointAngleArcs(overlayRoot) {
  const angleArcs = {
    enabled: true,
    arcs: new Map(),
    referenceMap: null,
  };

  JOINT_ANGLE_ARC_DEFINITIONS.forEach((definition) => {
    const arc = createJointAngleArc(definition);

    overlayRoot.add(arc.group);
    angleArcs.arcs.set(definition.id, arc);
  });

  return angleArcs;
}

function createJointAngleArc(definition) {
  const group = new THREE.Group();
  const line = createLine(definition.color, JOINT_ANGLE_ARC_SEGMENTS + 1);

  group.name = `${definition.id} joint angle arc`;
  line.line.renderOrder = 86;
  line.line.material.opacity = definition.type === 'rotation' ? 0.72 : 0.88;
  group.add(line.line);

  return {
    definition,
    group,
    line,
  };
}

function setAngleArcReferenceModel(angleArcs, model) {
  if (!angleArcs.arcs.size || !model) {
    return;
  }

  angleArcs.referenceMap = createObjectMap(model);
}

function setAngleArcsVisible(angleArcs, visible) {
  angleArcs.enabled = Boolean(visible && angleArcs.arcs.size);

  if (!angleArcs.enabled) {
    angleArcs.arcs.forEach((arc) => {
      arc.group.visible = false;
    });
  }
}

function updateJointAngleArcs(angleArcs, frame, root) {
  if (!angleArcs.enabled || !frame) {
    return;
  }

  const displayAnatomical = angleArcs.referenceMap
    ? sampleAnatomicalCoordinateSystem(angleArcs.referenceMap)
    : {
      landmarks: frame.anatomicalLandmarks,
      frames: frame.anatomicalFrames,
    };

  angleArcs.arcs.forEach((arc) => {
    if (arc.definition.type === 'rotation') {
      updatePelvisRotationArc(arc, displayAnatomical, root);
    } else {
      updateFlexionAngleArc(arc, displayAnatomical, root);
    }
  });
}

function updateFlexionAngleArc(arc, anatomical, root) {
  const { landmarks, frames } = anatomical;
  const { side, joint } = arc.definition;
  const pelvisFrame = frames?.pelvis;
  let center = null;
  let startDirection = null;
  let endDirection = null;
  let radiusBasis = null;

  if (!landmarks || !pelvisFrame) {
    arc.group.visible = false;
    return;
  }

  if (joint === 'hip') {
    const hip = landmarks[`${side}Hip`];
    const knee = landmarks[`${side}Knee`];

    if (hip && knee) {
      center = hip;
      startDirection = pelvisFrame.axes.y.clone().negate();
      endDirection = knee.clone().sub(hip);
      radiusBasis = endDirection.length();
    }
  } else if (joint === 'knee') {
    const hip = landmarks[`${side}Hip`];
    const knee = landmarks[`${side}Knee`];
    const ankle = landmarks[`${side}Ankle`];

    if (hip && knee && ankle) {
      center = knee;
      startDirection = knee.clone().sub(hip);
      endDirection = ankle.clone().sub(knee);
      radiusBasis = Math.min(startDirection.length(), endDirection.length());
    }
  } else if (joint === 'ankle') {
    const knee = landmarks[`${side}Knee`];
    const ankle = landmarks[`${side}Ankle`];
    const toe = landmarks[`${side}Toe`];

    if (knee && ankle && toe) {
      center = ankle;
      startDirection = ankle.clone().sub(knee);
      endDirection = toe.clone().sub(ankle);
      radiusBasis = endDirection.length();
    }
  }

  if (!center || !startDirection || !endDirection || !Number.isFinite(radiusBasis)) {
    arc.group.visible = false;
    return;
  }

  updateArcLine({
    arc,
    center,
    startDirection,
    endDirection,
    normalHint: pelvisFrame.axes.x,
    radius: clamp(radiusBasis * arc.definition.radiusScale, 0.08, 0.26),
    root,
  });
}

function updatePelvisRotationArc(arc, anatomical, root) {
  const pelvisFrame = anatomical.frames?.pelvis;

  if (!pelvisFrame) {
    arc.group.visible = false;
    return;
  }

  const worldForward = new THREE.Vector3(0, 0, 1);
  const normalHint = pelvisFrame.axes.y;
  const radiusBasis = getPelvisWidth(anatomical.landmarks) || 0.7;

  updateArcLine({
    arc,
    center: pelvisFrame.origin,
    startDirection: worldForward,
    endDirection: pelvisFrame.axes.z,
    normalHint,
    radius: clamp(radiusBasis * arc.definition.radiusScale, 0.18, 0.34),
    root,
  });
}

function updateArcLine({
  arc,
  center,
  startDirection,
  endDirection,
  normalHint,
  radius,
  root,
}) {
  let normal = safeNormalize(normalHint, new THREE.Vector3(0, 1, 0));
  let start = rejectVector(startDirection, normal);
  let end = rejectVector(endDirection, normal);

  if (start.lengthSq() <= EPSILON || end.lengthSq() <= EPSILON) {
    const fallbackNormal = startDirection.clone().cross(endDirection);

    if (fallbackNormal.lengthSq() <= EPSILON) {
      arc.group.visible = false;
      return;
    }

    normal = fallbackNormal.normalize();
    start = rejectVector(startDirection, normal);
    end = rejectVector(endDirection, normal);
  }

  if (start.lengthSq() <= EPSILON || end.lengthSq() <= EPSILON) {
    arc.group.visible = false;
    return;
  }

  start.normalize();
  end.normalize();

  const signedAngle = signedAngleBetween(start, end, normal);

  if (Math.abs(signedAngle) <= THREE.MathUtils.degToRad(2)) {
    arc.group.visible = false;
    return;
  }

  const points = [];

  for (let index = 0; index <= JOINT_ANGLE_ARC_SEGMENTS; index += 1) {
    const t = index / JOINT_ANGLE_ARC_SEGMENTS;
    const direction = start.clone().applyAxisAngle(normal, signedAngle * t);
    const worldPoint = center.clone().add(direction.multiplyScalar(radius));

    points.push(toRootLocal(root, worldPoint));
  }

  arc.group.visible = true;
  setLinePoints(arc.line, points);
}

function signedAngleBetween(start, end, normal) {
  const cosine = clamp(start.dot(end), -1, 1);
  const sine = start.clone().cross(end).dot(normal);

  return Math.atan2(sine, cosine);
}

function getPelvisWidth(landmarks) {
  const leftHip = landmarks?.leftHip;
  const rightHip = landmarks?.rightHip;

  return leftHip && rightHip ? leftHip.distanceTo(rightHip) : null;
}

function createObjectMap(root) {
  const map = new Map();

  root.traverse((object) => {
    if (!object.name) {
      return;
    }

    map.set(object.name, object);
    map.set(stripNamespace(object.name), object);
  });

  return map;
}

function createIkHelpers(overlayRoot, chains) {
  const helpers = {
    enabled: true,
    chains,
    referenceMap: null,
    targets: new Map(),
    poles: new Map(),
    limbs: new Map(),
    poleLines: new Map(),
    toeLines: new Map(),
  };

  chains.forEach((chain) => {
    const targetMarker = createMarker(chain.color, 'sphere');
    const poleMarker = createMarker(chain.poleColor, 'octahedron');

    overlayRoot.add(targetMarker, poleMarker);
    helpers.targets.set(chain.targetId, targetMarker);
    helpers.poles.set(chain.poleId, poleMarker);
  });

  return helpers;
}

function setIkReferenceModel(helpers, model) {
  if (!helpers.enabled || !model) {
    return;
  }

  const referenceMap = createObjectMap(model);

  helpers.referenceMap = referenceMap;
  helpers.chains.forEach((chain) => {
    chain.referenceRootBone = referenceMap.get(chain.rootBone.name) ?? null;
    chain.referenceMidBone = referenceMap.get(chain.midBone.name) ?? null;
    chain.referenceEndBone = referenceMap.get(chain.endBone.name) ?? null;
    chain.referenceToeBone = chain.toeBone ? referenceMap.get(chain.toeBone.name) ?? null : null;
  });
}

function updateIkHelpers(helpers, frame, root) {
  if (!helpers.enabled) {
    return;
  }

  Object.entries(frame.targets).forEach(([id, target]) => {
    const chain = helpers.chains.find((item) => item.targetId === id);
    const marker = helpers.targets.get(id);
    const limbLine = helpers.limbs.get(target.chainId);
    const toeLine = helpers.toeLines.get(target.chainId);
    const rootPosition = getDisplayPosition(chain?.referenceRootBone, target.rootPosition);
    const midPosition = getDisplayPosition(chain?.referenceMidBone, target.midPosition);
    const targetPosition = getDisplayPosition(chain?.referenceEndBone, target.position);
    const toePosition = getDisplayPosition(chain?.referenceToeBone, target.toePosition);

    if (marker) {
      marker.position.copy(toRootLocal(root, targetPosition));
      marker.userData.contact = target.contact;
      marker.material.color.setHex(target.contact ? 0xffffff : marker.userData.baseColor);
    }

    if (limbLine) {
      setLinePoints(limbLine, [
        toRootLocal(root, rootPosition),
        toRootLocal(root, midPosition),
        toRootLocal(root, targetPosition),
      ]);
    }

    if (toeLine && toePosition) {
      setLinePoints(toeLine, [
        toRootLocal(root, targetPosition),
        toRootLocal(root, toePosition),
      ]);
    }
  });

  Object.entries(frame.poles).forEach(([id, pole]) => {
    const chain = helpers.chains.find((item) => item.poleId === id);
    const marker = helpers.poles.get(id);
    const poleLine = helpers.poleLines.get(pole.chainId);
    const rootPosition = getDisplayPosition(chain?.referenceRootBone, pole.rootPosition);
    const midPosition = getDisplayPosition(chain?.referenceMidBone, pole.midPosition);
    const endPosition = getDisplayPosition(chain?.referenceEndBone, pole.endPosition);
    const polePosition = chain?.referenceRootBone && chain?.referenceMidBone && chain?.referenceEndBone
      ? computePoleTransform(rootPosition, midPosition, endPosition).position
      : pole.position;

    if (marker) {
      marker.position.copy(toRootLocal(root, polePosition));
    }

    if (poleLine) {
      setLinePoints(poleLine, [
        toRootLocal(root, midPosition),
        toRootLocal(root, polePosition),
      ]);
    }
  });
}

function getDisplayPosition(referenceBone, fallbackPosition) {
  if (referenceBone) {
    return referenceBone.getWorldPosition(new THREE.Vector3());
  }

  return fallbackPosition?.clone?.() ?? fallbackPosition ?? new THREE.Vector3();
}

function buildAnalysisFrames({ metadata, contactBaselines, setTime, getRestoreTime }) {
  const restoreTime = getRestoreTime();
  const frames = [];

  for (let frameIndex = 0; frameIndex < metadata.frames; frameIndex += 1) {
    frames.push(serializeAnalysisFrame(setTime(frameIndex * metadata.frameTime, { updateVisuals: false })));
  }

  setTime(restoreTime);

  return {
    metadata: {
      url: metadata.url,
      bones: metadata.bones,
      channels: metadata.channels,
      frames: metadata.frames,
      frameTime: metadata.frameTime,
      sampleRate: roundUnit(metadata.sampleRate),
      duration: roundUnit(metadata.duration),
      units: 'meters after BVH scale/alignment',
      angleUnits: 'degrees',
      footContactBaselines: contactBaselines,
    },
    frames,
  };
}

function serializeAnalysisFrame(frame) {
  return {
    frame: frame.frameIndex,
    time: roundUnit(frame.time),
    root: {
      position: serializeVector(frame.root.position),
      eulerDeg: serializeEuler(frame.root.euler),
    },
    gaitAngles: frame.gaitAngles,
    ikTargets: Object.fromEntries(Object.entries(frame.targets).map(([id, target]) => [
      id,
      {
        label: target.label,
        position: serializeVector(target.position),
        eulerDeg: serializeEuler(target.euler),
        rootPosition: target.rootPosition ? serializeVector(target.rootPosition) : null,
        midPosition: target.midPosition ? serializeVector(target.midPosition) : null,
        toePosition: target.toePosition ? serializeVector(target.toePosition) : null,
        toeDirection: target.toeDirection ? serializeVector(target.toeDirection) : null,
        contact: target.contact,
      },
    ])),
    ikPoles: Object.fromEntries(Object.entries(frame.poles).map(([id, pole]) => [
      id,
      {
        label: pole.label,
        position: serializeVector(pole.position),
        direction: serializeVector(pole.direction),
      },
    ])),
    anatomicalFrames: serializeAnatomicalFrames(frame.anatomicalFrames),
    anatomicalJointAngles: frame.anatomicalJointAngles,
    bvhChannels: frame.bvhChannels,
    localJointRotations: frame.jointRotations,
  };
}

function serializeAnatomicalFrames(frames) {
  return Object.fromEntries(Object.entries(frames).map(([id, frame]) => [
    id,
    frame ? {
      origin: serializeVector(frame.origin),
      axes: {
        x: serializeVector(frame.axes.x),
        y: serializeVector(frame.axes.y),
        z: serializeVector(frame.axes.z),
      },
      quaternion: {
        x: roundUnit(frame.quaternion.x),
        y: roundUnit(frame.quaternion.y),
        z: roundUnit(frame.quaternion.z),
        w: roundUnit(frame.quaternion.w),
      },
    } : null,
  ]));
}

function buildAnalysisCsv(analysis) {
  const rows = analysis.frames.map((frame) => {
    const row = {
      frame: frame.frame,
      time: frame.time,
      root_x: frame.root.position.x,
      root_y: frame.root.position.y,
      root_z: frame.root.position.z,
    };

    appendSideAngles(row, 'left', frame.gaitAngles.left);
    appendSideAngles(row, 'right', frame.gaitAngles.right);
    appendTarget(row, 'left_hand', frame.ikTargets.leftHand);
    appendTarget(row, 'right_hand', frame.ikTargets.rightHand);
    appendTarget(row, 'left_foot', frame.ikTargets.leftFoot);
    appendTarget(row, 'right_foot', frame.ikTargets.rightFoot);
    appendPole(row, 'left_elbow', frame.ikPoles.leftElbow);
    appendPole(row, 'right_elbow', frame.ikPoles.rightElbow);
    appendPole(row, 'left_knee', frame.ikPoles.leftKnee);
    appendPole(row, 'right_knee', frame.ikPoles.rightKnee);
    appendAnatomicalAngles(row, 'left', frame.anatomicalJointAngles.left);
    appendAnatomicalAngles(row, 'right', frame.anatomicalJointAngles.right);
    appendRawRotationChannels(row, frame.bvhChannels);
    return row;
  });
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set()));

  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\n');
}

function appendSideAngles(row, side, angles) {
  row[`${side}_hip_flexion_deg`] = angles?.hipFlexionDeg ?? '';
  row[`${side}_hip_included_deg`] = angles?.hipIncludedDeg ?? '';
  row[`${side}_knee_flexion_deg`] = angles?.kneeFlexionDeg ?? '';
  row[`${side}_knee_included_deg`] = angles?.kneeIncludedDeg ?? '';
  row[`${side}_ankle_included_deg`] = angles?.ankleIncludedDeg ?? '';
  row[`${side}_foot_pitch_deg`] = angles?.footPitchDeg ?? '';
  row[`${side}_foot_contact`] = angles?.contact ? 1 : 0;
}

function appendTarget(row, prefix, target) {
  if (!target) {
    return;
  }

  row[`${prefix}_x`] = target.position.x;
  row[`${prefix}_y`] = target.position.y;
  row[`${prefix}_z`] = target.position.z;
  row[`${prefix}_rot_x_deg`] = target.eulerDeg.x;
  row[`${prefix}_rot_y_deg`] = target.eulerDeg.y;
  row[`${prefix}_rot_z_deg`] = target.eulerDeg.z;

  if (target.contact !== null) {
    row[`${prefix}_contact`] = target.contact ? 1 : 0;
  }
}

function appendPole(row, prefix, pole) {
  if (!pole) {
    return;
  }

  row[`${prefix}_pole_x`] = pole.position.x;
  row[`${prefix}_pole_y`] = pole.position.y;
  row[`${prefix}_pole_z`] = pole.position.z;
  row[`${prefix}_pole_dir_x`] = pole.direction.x;
  row[`${prefix}_pole_dir_y`] = pole.direction.y;
  row[`${prefix}_pole_dir_z`] = pole.direction.z;
}

function appendAnatomicalAngles(row, side, sideAngles) {
  appendAnatomicalJoint(row, `${side}_hip`, sideAngles?.hip);
  appendAnatomicalJoint(row, `${side}_knee`, sideAngles?.knee);
  appendAnatomicalJoint(row, `${side}_ankle`, sideAngles?.ankle);
}

function appendAnatomicalJoint(row, prefix, angles) {
  row[`${prefix}_acs_flexion_extension_deg`] = angles?.flexionExtensionDeg ?? '';
  row[`${prefix}_acs_abduction_adduction_deg`] = angles?.abductionAdductionDeg ?? '';
  row[`${prefix}_acs_internal_external_deg`] = angles?.internalExternalRotationDeg ?? '';
}

function appendRawRotationChannels(row, bvhChannels) {
  [
    'Hips',
    'LeftUpLeg',
    'LeftLeg',
    'LeftFoot',
    'LeftToeBase',
    'RightUpLeg',
    'RightLeg',
    'RightFoot',
    'RightToeBase',
  ].forEach((jointName) => {
    const joint = bvhChannels[jointName]?.channels;

    if (!joint) {
      return;
    }

    ['Xrotation', 'Yrotation', 'Zrotation'].forEach((channel) => {
      if (joint[channel] !== undefined) {
        row[`raw_${jointName}_${channel}_deg`] = joint[channel];
      }
    });
  });
}

function csvCell(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function createMarker(color, shape) {
  const geometry = shape === 'octahedron'
    ? new THREE.OctahedronGeometry(0.055, 0)
    : new THREE.SphereGeometry(0.045, 16, 10);
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
  });
  const marker = new THREE.Mesh(geometry, material);

  marker.renderOrder = 50;
  marker.frustumCulled = false;
  marker.userData.baseColor = color;
  return marker;
}

function createLine(color, pointCount) {
  const positions = new Float32Array(pointCount * 3);
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.82,
  });
  const line = new THREE.Line(geometry, material);

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  line.renderOrder = 45;
  line.frustumCulled = false;

  return {
    line,
    positions,
  };
}

function setLinePoints(helper, points) {
  points.forEach((point, index) => {
    helper.positions[index * 3] = point.x;
    helper.positions[index * 3 + 1] = point.y;
    helper.positions[index * 3 + 2] = point.z;
  });

  helper.line.geometry.setDrawRange(0, points.length);
  helper.line.geometry.attributes.position.needsUpdate = true;
  helper.line.geometry.computeBoundingSphere();
}

function createTextSprite(text, color, fontSize = 28, scale = 0.0019) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const paddingX = 14;
  const paddingY = 8;

  context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
  const width = Math.ceil(context.measureText(text).width + paddingX * 2);
  const height = fontSize + paddingY * 2;

  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);

  context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
  context.fillStyle = 'rgba(8, 9, 8, 0.78)';
  drawRoundRect(context, 0, 0, canvas.width, canvas.height, 6);
  context.fill();
  context.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
  context.lineWidth = 2;
  drawRoundRect(context, 1, 1, canvas.width - 2, canvas.height - 2, 6);
  context.stroke();
  context.fillStyle = '#f4f6ef';
  context.textBaseline = 'middle';
  context.fillText(text, paddingX, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  }));
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.renderOrder = 60;
  return sprite;
}

function drawRoundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function wrapClipTime(time, duration, frameTime) {
  if (duration <= 0) {
    return 0;
  }

  if (Math.abs(time - duration) <= frameTime * 0.5) {
    return duration;
  }

  return ((time % duration) + duration) % duration;
}

function toRootLocal(root, worldPosition) {
  return root.worldToLocal(worldPosition.clone());
}

function stripNamespace(name) {
  const shortName = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;

  return shortName.replace(/^mixamorig/, '');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function percentile(values, amount) {
  const finiteValues = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!finiteValues.length) {
    return null;
  }

  const index = clamp(
    Math.round((finiteValues.length - 1) * amount),
    0,
    finiteValues.length - 1,
  );

  return finiteValues[index];
}

function serializeVector(vector) {
  return {
    x: roundUnit(vector.x),
    y: roundUnit(vector.y),
    z: roundUnit(vector.z),
  };
}

function serializeEuler(euler) {
  return {
    x: roundAngle(THREE.MathUtils.radToDeg(euler.x)),
    y: roundAngle(THREE.MathUtils.radToDeg(euler.y)),
    z: roundAngle(THREE.MathUtils.radToDeg(euler.z)),
  };
}

function roundAngle(value) {
  return Math.round(value * 1000) / 1000;
}

function roundUnit(value) {
  return Math.round(value * 1000000) / 1000000;
}
