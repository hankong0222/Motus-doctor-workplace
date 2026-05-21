import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

export const DEFAULT_BVH_URL = '/asset/cJM4ngRqXg83-m9THA1iEvbnr.bvh';

const DEFAULT_BVH_SCALE = 0.01;
const FOOT_CONTACT_THRESHOLD = 0.055;
const EPSILON = 0.000001;

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
  showVisuals = false,
} = {}) {
  const root = new THREE.Group();
  const skeletonRoot = new THREE.Group();
  const overlayRoot = new THREE.Group();

  root.name = 'BVH IK Debug';
  root.visible = showVisuals;
  skeletonRoot.name = 'BVH calculation source';
  skeletonRoot.scale.setScalar(scale);
  overlayRoot.name = 'IK target debug overlay';

  root.add(skeletonRoot, overlayRoot);

  const ready = loadBvhIkDebug({ url, root, skeletonRoot, overlayRoot, showVisuals });
  root.userData.ready = ready;

  return {
    root,
    ready,
  };
}

async function loadBvhIkDebug({ url, root, skeletonRoot, overlayRoot, showVisuals }) {
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
  const helpers = showVisuals ? createIkHelpers(overlayRoot, chains) : createEmptyIkHelpers();
  const skeletonHelper = showVisuals ? createSkeletonHelper(rootBone) : null;

  if (skeletonHelper) {
    root.add(skeletonHelper);
  }

  alignSkeletonRoot(skeletonRoot, rootBone, skeleton.bones);
  root.updateMatrixWorld(true);

  const contactBaselines = computeContactBaselines({
    metadata,
    mixer,
    root,
    chains,
  });
  let currentFrame = null;
  const setTime = (time) => {
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
    updateIkHelpers(helpers, currentFrame, root);
    return currentFrame;
  };

  currentFrame = setTime(0);

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

  chains.filter((chain) => chain.contact).forEach((chain) => {
    baselines[chain.targetId] = Infinity;
  });

  for (let frameIndex = 0; frameIndex < metadata.frames; frameIndex += 1) {
    mixer.setTime(frameIndex * metadata.frameTime);
    root.updateMatrixWorld(true);

    chains.filter((chain) => chain.contact).forEach((chain) => {
      const foot = chain.endBone.getWorldPosition(new THREE.Vector3());
      const toe = chain.toeBone?.getWorldPosition(new THREE.Vector3()) ?? null;
      const lowest = toe ? Math.min(foot.y, toe.y) : foot.y;

      baselines[chain.targetId] = Math.min(baselines[chain.targetId], lowest);
    });
  }

  Object.keys(baselines).forEach((key) => {
    if (!Number.isFinite(baselines[key])) {
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
    targets: new Map(),
    poles: new Map(),
    limbs: new Map(),
    poleLines: new Map(),
    toeLines: new Map(),
  };
}

function createIkHelpers(overlayRoot, chains) {
  const helpers = {
    enabled: true,
    targets: new Map(),
    poles: new Map(),
    limbs: new Map(),
    poleLines: new Map(),
    toeLines: new Map(),
  };

  chains.forEach((chain) => {
    const targetMarker = createMarker(chain.color, 'sphere');
    const poleMarker = createMarker(chain.poleColor, 'octahedron');
    const limbLine = createLine(chain.color, 3);
    const poleLine = createLine(chain.poleColor, 2);
    const targetLabel = createTextSprite(chain.targetLabel, chain.color);
    const poleLabel = createTextSprite(chain.poleLabel, chain.poleColor);

    targetMarker.add(targetLabel);
    poleMarker.add(poleLabel);
    targetLabel.position.set(0, 0.12, 0);
    poleLabel.position.set(0, 0.1, 0);

    overlayRoot.add(targetMarker, poleMarker, limbLine.line, poleLine.line);
    helpers.targets.set(chain.targetId, targetMarker);
    helpers.poles.set(chain.poleId, poleMarker);
    helpers.limbs.set(chain.id, limbLine);
    helpers.poleLines.set(chain.id, poleLine);

    if (chain.toeBone) {
      const toeLine = createLine(chain.color, 2);
      overlayRoot.add(toeLine.line);
      helpers.toeLines.set(chain.id, toeLine);
    }
  });

  return helpers;
}

function updateIkHelpers(helpers, frame, root) {
  if (!helpers.enabled) {
    return;
  }

  Object.entries(frame.targets).forEach(([id, target]) => {
    const marker = helpers.targets.get(id);
    const limbLine = helpers.limbs.get(target.chainId);
    const toeLine = helpers.toeLines.get(target.chainId);

    if (marker) {
      marker.position.copy(toRootLocal(root, target.position));
      marker.userData.contact = target.contact;
      marker.material.color.setHex(target.contact ? 0xffffff : marker.userData.baseColor);
    }

    if (limbLine) {
      setLinePoints(limbLine, [
        toRootLocal(root, target.rootPosition),
        toRootLocal(root, target.midPosition),
        toRootLocal(root, target.position),
      ]);
    }

    if (toeLine && target.toePosition) {
      setLinePoints(toeLine, [
        toRootLocal(root, target.position),
        toRootLocal(root, target.toePosition),
      ]);
    }
  });

  Object.entries(frame.poles).forEach(([id, pole]) => {
    const marker = helpers.poles.get(id);
    const poleLine = helpers.poleLines.get(pole.chainId);

    if (marker) {
      marker.position.copy(toRootLocal(root, pole.position));
    }

    if (poleLine) {
      setLinePoints(poleLine, [
        toRootLocal(root, pole.midPosition),
        toRootLocal(root, pole.position),
      ]);
    }
  });
}

function buildAnalysisFrames({ metadata, contactBaselines, setTime, getRestoreTime }) {
  const restoreTime = getRestoreTime();
  const frames = [];

  for (let frameIndex = 0; frameIndex < metadata.frames; frameIndex += 1) {
    frames.push(serializeAnalysisFrame(setTime(frameIndex * metadata.frameTime)));
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
    bvhChannels: frame.bvhChannels,
    localJointRotations: frame.jointRotations,
  };
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

  helper.line.geometry.attributes.position.needsUpdate = true;
  helper.line.geometry.computeBoundingSphere();
}

function createTextSprite(text, color) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const fontSize = 28;
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
  sprite.scale.set(canvas.width * 0.0019, canvas.height * 0.0019, 1);
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
