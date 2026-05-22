import { createGymEnvironment } from '../three/gym.js';
import { createBvhIkDebug } from '../three/bvh-ik-debug.js';
import { createThreeScene } from '../three/scene.js';
import * as THREE from 'three';

const FRAME_RATE = 30;
const VIDEO_SEEK_EPSILON = 0.5 / FRAME_RATE;
const VIDEO_END_EPSILON = 0.001;
const TRAJECTORY_SPHERE_VIEW = {
  yaw: -0.68,
  pitch: 0.34,
};
const TRAJECTORY_SPHERE_SERIES = [
  { id: 'pelvisLr', frameId: 'pelvis', axis: 'x', label: 'Pelvis LR', shortLabel: 'LR', color: '#ff4d4d' },
  { id: 'pelvisUp', frameId: 'pelvis', axis: 'y', label: 'Pelvis Up', shortLabel: 'Up', color: '#58d86f' },
  { id: 'pelvisFwd', frameId: 'pelvis', axis: 'z', label: 'Pelvis Fwd', shortLabel: 'Fwd', color: '#4d8dff' },
];
const TRAJECTORY_CYCLE_COLORS = [
  '#4d8dff',
  '#48f0ff',
  '#f4f6ef',
  '#b78cff',
  '#85f06c',
  '#ffd166',
  '#ff6b6b',
];
const TRAJECTORY_PHASE_SAMPLES = 80;
const TRAJECTORY_VARIANCE_BAND_SCALE = 0.86;
const COM_SUPPORT_FOOT_HALF_WIDTH = 0.055;
const COM_SUPPORT_HEEL_EXTENSION = 0.08;
const COM_SUPPORT_TOE_EXTENSION = 0.035;
const COM_SUPPORT_HEIGHT_QUANTILE = 0.42;
const COM_SUPPORT_SPEED_QUANTILE = 0.46;
const COM_SUPPORT_FALLBACK_HEIGHT_NORM = 0.68;
const COM_STABILITY_RENDER_FRAME_STEP = 2;
const DEBUG_JOINTS = [
  'Hips',
  'Spine',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'LeftToeBase',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToeBase',
];
const DEBUG_LOCAL_ROTATION_JOINTS = [
  'Hips',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
];

const canvas = document.querySelector('#gym-canvas');
const status = document.querySelector('#scene-status');
const video = document.querySelector('#reference-video');
const playToggle = document.querySelector('#play-toggle');
const stepBack = document.querySelector('#step-back');
const stepForward = document.querySelector('#step-forward');
const scrubber = document.querySelector('#timeline-scrubber');
const timelineTime = document.querySelector('#timeline-time');
const speedSelect = document.querySelector('#speed-select');
const ikDebugStatus = document.querySelector('#ik-debug-status');
const ikDebugReadout = document.querySelector('#ik-debug-readout');
const ikExportJson = document.querySelector('#ik-export-json');
const ikExportCsv = document.querySelector('#ik-export-csv');
const bvhVisualToggle = document.querySelector('#bvh-visual-toggle');
const bodyAxisToggle = document.querySelector('#body-axis-toggle');
const debugDashboardTab = document.querySelector('#debug-dashboard-tab');
const trajectorySphereTab = document.querySelector('#trajectory-sphere-tab');
const debugDashboardView = document.querySelector('#debug-dashboard-view');
const trajectorySphereView = document.querySelector('#trajectory-sphere-view');
const trajectorySphereCanvas = document.querySelector('#trajectory-sphere-canvas');
const trajectorySphereFrame = document.querySelector('#trajectory-sphere-frame');
const trajectorySphereVector = document.querySelector('#trajectory-sphere-vector');
const comStabilityCanvas = document.querySelector('#com-stability-canvas');
const comStabilityStatus = document.querySelector('#com-stability-status');
const comStabilityReadout = document.querySelector('#com-stability-readout');

const three = createThreeScene(canvas);
const gym = createGymEnvironment();
const bvhIkDebug = createBvhIkDebug({
  showSkeleton: true,
  showIkHelpers: false,
  showAxisGizmos: true,
  showAngleArcs: true,
  showAxisTrails: true,
});
const followTargetPosition = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const nextTarget = new THREE.Vector3();
const targetDelta = new THREE.Vector3();
const cameraOffset = new THREE.Vector3(3.4, 1.85, 5.2);
const cameraPanForward = new THREE.Vector3();
const cameraPanRight = new THREE.Vector3();
const cameraPanDelta = new THREE.Vector3();
const CAMERA_RECENTER_DELAY = 2.5;
const CAMERA_KEY_PAN_STEP = 0.48;
let followTarget = null;
let fpsElapsed = 0;
let fpsFrames = 0;
let latestFps = 0;
let playAttemptId = 0;
let cameraFollowResumeAt = 0;
let isShiftPanningCamera = false;

const timeline = {
  animationDuration: 0,
  animationFrameCount: 0,
  animationTargets: [],
  frame: 0,
  frameCount: 1,
  frameCursor: 0,
  ikReady: false,
  isPlaying: true,
  manualClock: false,
  modelReady: false,
  speed: Number(speedSelect.value),
  videoReady: false,
};

scrubber.min = '0';
scrubber.max = '0';
scrubber.step = '1';
scrubber.disabled = true;
video.muted = true;
video.defaultMuted = true;
video.setAttribute('muted', '');
video.loop = true;
video.playbackRate = timeline.speed;
canvas.tabIndex = 0;

let bvhIkRuntime = null;
let glbReferenceModel = null;
let latestIkReadoutFrame = -1;
let bvhVisualsVisible = true;
let bodyAxisVisible = true;
let activeDebugView = 'dashboard';
const trajectorySphere = createFrameTrajectorySphere({
  canvas: trajectorySphereCanvas,
  frameElement: trajectorySphereFrame,
  vectorElement: trajectorySphereVector,
});
const comStabilityUi = createComStabilityUi({
  canvas: comStabilityCanvas,
  readoutElement: comStabilityReadout,
  statusElement: comStabilityStatus,
});

three.scene.add(gym.lightRig, gym.gridFloor, bvhIkDebug.root);
three.start(({ delta }) => {
  updateFps(delta);
  updatePlayback(delta);
  updateCameraFollow(delta);
});

canvas.addEventListener('pointerdown', handleCameraPointerDown);
window.addEventListener('pointerup', handleCameraPointerEnd);
window.addEventListener('pointercancel', handleCameraPointerEnd);
window.addEventListener('blur', handleCameraPointerEnd);
document.addEventListener('keydown', handleCameraKeyDown);

video.addEventListener('loadedmetadata', handleVideoMetadataLoaded);

if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
  handleVideoMetadataLoaded();
}

function handleVideoMetadataLoaded() {
  timeline.videoReady = true;
  refreshTimelineBounds();
  setFrame(timeline.frame, { syncVideo: true });
  tryPlayVideo();
}

video.addEventListener('ratechange', () => {
  if (video.playbackRate !== timeline.speed) {
    video.playbackRate = timeline.speed;
  }
});

video.addEventListener('seeked', () => {
  if (!timeline.isPlaying) {
    syncFrameFromVideo();
  }
});

playToggle.addEventListener('click', () => {
  setPlaying(!timeline.isPlaying);
});

stepBack.addEventListener('click', () => {
  setPlaying(false);
  setFrame(timeline.frame - 1, { syncVideo: true, wrap: true });
});

stepForward.addEventListener('click', () => {
  setPlaying(false);
  setFrame(timeline.frame + 1, { syncVideo: true, wrap: true });
});

scrubber.addEventListener('input', () => {
  scrubToCurrentFrame();
});

scrubber.addEventListener('change', () => {
  scrubToCurrentFrame();
});

scrubber.addEventListener('click', () => {
  scrubToCurrentFrame();
});

scrubber.addEventListener('pointerup', () => {
  scrubToCurrentFrame();
});

speedSelect.addEventListener('change', () => {
  timeline.speed = Number(speedSelect.value);
  video.playbackRate = timeline.speed;

  if (timeline.isPlaying) {
    tryPlayVideo();
  }
});

ikExportJson.addEventListener('click', () => {
  exportBvhAnalysis('json');
});

ikExportCsv.addEventListener('click', () => {
  exportBvhAnalysis('csv');
});

bvhVisualToggle.addEventListener('click', () => {
  setBvhVisualsVisible(!bvhVisualsVisible);
});

bodyAxisToggle.addEventListener('click', () => {
  setBodyAxisVisible(!bodyAxisVisible);
});

debugDashboardTab.addEventListener('click', () => {
  setDebugPanelView('dashboard');
});

trajectorySphereTab.addEventListener('click', () => {
  setDebugPanelView('sphere');
});

window.addEventListener('resize', () => {
  trajectorySphere.resize();
  comStabilityUi.resize();
});

document.addEventListener('keydown', (event) => {
  if (!isBvhToggleShortcut(event)) {
    return;
  }

  event.preventDefault();
  setBvhVisualsVisible(!bvhVisualsVisible);
});

gym.modelReady
  .then((result) => {
    if (result?.model) {
      glbReferenceModel = result.model;
      followTarget = result.followTarget ?? gym.modelRoot.userData.followTarget ?? result.model;
      timeline.modelReady = true;
      registerAnimationTarget('glb', {
        duration: result.animation?.duration ?? result.animations?.[0]?.duration ?? 0,
        setTime: result.animation?.setTime ?? null,
      });

      followTarget.getWorldPosition(followTargetPosition);
      three.controls.target.set(followTargetPosition.x, 1.35, followTargetPosition.z);
      three.camera.position.copy(three.controls.target).add(cameraOffset);
      three.controls.update();

      refreshTimelineBounds();
      setFrame(timeline.frame, { syncVideo: true });
      bvhIkRuntime?.setReferenceModel(glbReferenceModel);
      tryPlayVideo();
    }

    status.textContent = formatStatus();
  })
  .catch((error) => {
    console.error(error);
    status.textContent = 'Model failed';
  });

bvhIkDebug.ready
  .then((runtime) => {
    bvhIkRuntime = runtime;
    timeline.ikReady = true;
    window.motusBvhIkDebug = runtime;

    registerAnimationTarget('bvh-ik', {
      duration: runtime.metadata.duration,
      frameCount: runtime.metadata.frames,
      setTime: runtime.setTime,
    });

    updateIkDebugStatus();
    applyDebugVisualVisibility();
    ikExportJson.disabled = false;
    ikExportCsv.disabled = false;
    if (glbReferenceModel) {
      runtime.setReferenceModel(glbReferenceModel);
    }
    updateIkDebugUi(runtime.getCurrentFrame(), true);
    prepareTrajectorySphere(runtime);
    setFrame(timeline.frame, { syncVideo: true });
    tryPlayVideo();
  })
  .catch((error) => {
    console.error(error);
    ikDebugStatus.textContent = 'BVH failed';
    ikDebugReadout.textContent = error.message;
  });

function scrubToCurrentFrame() {
  setPlaying(false);
  setFrame(Number(scrubber.value), { syncVideo: true, wrap: false });
}

function updatePlayback(delta) {
  if (!timeline.isPlaying || !hasAnimationTargets() || timeline.frameCount <= 1) {
    return;
  }

  if (canUseVideoClock()) {
    timeline.manualClock = false;
    syncPlaybackFromVideo();
    return;
  }

  advanceManualClock(delta);
}

function updateFps(delta) {
  fpsElapsed += delta;
  fpsFrames += 1;

  if (fpsElapsed >= 0.5) {
    latestFps = Math.round(fpsFrames / fpsElapsed);
    fpsElapsed = 0;
    fpsFrames = 0;

    if (hasAnimationTargets()) {
      status.textContent = formatStatus();
    }
  }
}

function updateCameraFollow(delta) {
  if (!followTarget) {
    return;
  }

  if (getNowSeconds() < cameraFollowResumeAt) {
    return;
  }

  followTarget.getWorldPosition(followTargetPosition);
  desiredTarget.set(followTargetPosition.x, 1.35, followTargetPosition.z);

  const alpha = 1 - Math.exp(-delta * 5.5);
  nextTarget.copy(three.controls.target).lerp(desiredTarget, alpha);
  targetDelta.subVectors(nextTarget, three.controls.target);
  three.controls.target.copy(nextTarget);
  three.camera.position.add(targetDelta);
}

function handleCameraPointerDown(event) {
  canvas.focus({ preventScroll: true });

  if (event.button !== 0 || !event.shiftKey) {
    return;
  }

  isShiftPanningCamera = true;
  cameraFollowResumeAt = Number.POSITIVE_INFINITY;
}

function handleCameraPointerEnd() {
  if (!isShiftPanningCamera) {
    return;
  }

  isShiftPanningCamera = false;
  scheduleCameraFollowResume();
}

function handleCameraKeyDown(event) {
  if (!isCameraPanKey(event) || shouldIgnoreCameraKeyPan(event)) {
    return;
  }

  event.preventDefault();
  panCameraByKey(event.key);
  scheduleCameraFollowResume();
  three.controls.update();
}

function panCameraByKey(key) {
  const distance = getCameraKeyPanDistance();

  cameraPanForward.subVectors(three.controls.target, three.camera.position);
  cameraPanForward.y = 0;

  if (cameraPanForward.lengthSq() < 0.0001) {
    cameraPanForward.set(0, 0, -1);
  } else {
    cameraPanForward.normalize();
  }

  cameraPanRight.crossVectors(cameraPanForward, three.camera.up).normalize();
  cameraPanDelta.set(0, 0, 0);

  if (key === 'ArrowUp') {
    cameraPanDelta.addScaledVector(cameraPanForward, distance);
  } else if (key === 'ArrowDown') {
    cameraPanDelta.addScaledVector(cameraPanForward, -distance);
  } else if (key === 'ArrowLeft') {
    cameraPanDelta.addScaledVector(cameraPanRight, -distance);
  } else if (key === 'ArrowRight') {
    cameraPanDelta.addScaledVector(cameraPanRight, distance);
  }

  three.controls.target.add(cameraPanDelta);
  three.camera.position.add(cameraPanDelta);
}

function getCameraKeyPanDistance() {
  const cameraDistance = three.camera.position.distanceTo(three.controls.target);
  return Math.min(Math.max(cameraDistance * 0.08, CAMERA_KEY_PAN_STEP), 1.4);
}

function isCameraPanKey(event) {
  return event.key === 'ArrowUp'
    || event.key === 'ArrowDown'
    || event.key === 'ArrowLeft'
    || event.key === 'ArrowRight';
}

function shouldIgnoreCameraKeyPan(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return true;
  }

  const target = event.target;

  return target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement
    || target?.isContentEditable;
}

function scheduleCameraFollowResume() {
  cameraFollowResumeAt = timeline.isPlaying
    ? getNowSeconds() + CAMERA_RECENTER_DELAY
    : Number.POSITIVE_INFINITY;
}

function getNowSeconds() {
  return performance.now() / 1000;
}

function setPlaying(isPlaying) {
  timeline.isPlaying = isPlaying;
  updatePlayButton();

  if (!isPlaying) {
    cameraFollowResumeAt = Number.POSITIVE_INFINITY;
    playAttemptId += 1;
    video.pause();
    syncFrameFromVideo();
    seekVideoToFrame(timeline.frame, true);
    return;
  }

  timeline.manualClock = false;
  scheduleCameraFollowResume();
  tryPlayVideo();
}

function updatePlayButton() {
  playToggle.textContent = timeline.isPlaying ? 'Pause' : 'Play';
}

function tryPlayVideo() {
  if (!timeline.isPlaying || !timeline.videoReady || !hasAnimationTargets()) {
    return;
  }

  const attemptId = playAttemptId + 1;
  playAttemptId = attemptId;
  video.playbackRate = timeline.speed;
  playVideo(attemptId);
}

function playVideo(attemptId) {
  if (attemptId !== playAttemptId || !timeline.isPlaying) {
    return;
  }

  video.play()
    .then(() => {
      if (attemptId === playAttemptId) {
        timeline.manualClock = false;
      }
    })
    .catch(() => {
      if (attemptId !== playAttemptId || !timeline.isPlaying) {
        return;
      }

      timeline.manualClock = true;
      updatePlayButton();
    });
}

function advanceManualClock(delta) {
  timeline.frameCursor += delta * FRAME_RATE * timeline.speed;
  timeline.frameCursor = wrapFrame(timeline.frameCursor);
  syncModelToTime(frameToSeconds(timeline.frameCursor));

  const nextFrame = Math.floor(timeline.frameCursor);

  if (nextFrame !== timeline.frame) {
    timeline.frame = nextFrame;
    updateTimelineUi();

    if (timeline.videoReady) {
      seekVideoToFrame(nextFrame, true);
    }
  }
}

function refreshTimelineBounds() {
  const videoFrameCount = timeline.videoReady && Number.isFinite(video.duration) && video.duration > 0
    ? Math.round(video.duration * FRAME_RATE)
    : 0;
  const animationFrameCount = timeline.animationDuration > 0
    ? Math.max(timeline.animationFrameCount, Math.round(timeline.animationDuration * FRAME_RATE) + 1)
    : 0;
  const nextFrameCount = Math.max(videoFrameCount, animationFrameCount, 1);

  const frameCountChanged = nextFrameCount !== timeline.frameCount;

  if (frameCountChanged) {
    timeline.frameCount = nextFrameCount;
    timeline.frame = clampFrame(timeline.frame);
    timeline.frameCursor = timeline.frame;
  }

  const maxFrame = String(Math.max(timeline.frameCount - 1, 0));
  const isDisabled = timeline.frameCount <= 1;

  if (scrubber.max !== maxFrame) {
    scrubber.max = maxFrame;
  }

  if (scrubber.disabled !== isDisabled) {
    scrubber.disabled = isDisabled;
  }

  if (frameCountChanged) {
    updateTimelineUi();
  }

  return timeline.frameCount;
}

function setFrame(frame, { syncVideo = false, wrap = false } = {}) {
  const nextFrame = wrap
    ? wrapFrame(Math.round(frame))
    : clampFrame(Math.round(frame));
  const frameChanged = nextFrame !== timeline.frame;

  timeline.frame = nextFrame;
  timeline.frameCursor = nextFrame;

  if (frameChanged || syncVideo) {
    syncModelToTime(frameToSeconds(nextFrame));
  }

  if (syncVideo) {
    seekVideoToFrame(nextFrame, true);
  }

  if (frameChanged || syncVideo) {
    updateTimelineUi();
  }
}

function syncFrameFromVideo() {
  if (!timeline.videoReady || !Number.isFinite(video.duration) || video.duration <= 0) {
    return;
  }

  const frame = videoTimeToFrame(video.currentTime);
  const frameTime = frameToSeconds(frame);

  timeline.frameCursor = frame;
  syncModelToTime(frameTime);

  if (frame === timeline.frame) {
    return;
  }

  timeline.frame = frame;
  updateTimelineUi();
}

function syncPlaybackFromVideo() {
  if (!timeline.videoReady || !Number.isFinite(video.duration) || video.duration <= 0) {
    return;
  }

  const videoTime = video.currentTime;
  const frame = videoTimeToFrame(videoTime);

  timeline.frameCursor = videoTime * FRAME_RATE;
  syncModelToTime(videoTime);

  if (frame === timeline.frame) {
    return;
  }

  timeline.frame = frame;
  updateTimelineUi();
}

function syncModelToTime(time) {
  if (!hasAnimationTargets()) {
    return;
  }

  timeline.animationTargets
    .filter((target) => target.id !== 'bvh-ik')
    .forEach((target) => {
      target.setTime?.(time);
    });

  timeline.animationTargets
    .filter((target) => target.id === 'bvh-ik')
    .forEach((target) => {
      const frame = target.setTime?.(time);

      if (frame) {
        updateIkDebugUi(frame);
      }
    });
}

function seekVideoToFrame(frame, force) {
  if (!timeline.videoReady || !Number.isFinite(video.duration) || video.duration <= 0) {
    return;
  }

  const targetTime = clamp(
    frameToSeconds(frame),
    0,
    Math.max(video.duration - VIDEO_END_EPSILON, 0),
  );
  const drift = Math.abs(video.currentTime - targetTime);

  if (force || drift > VIDEO_SEEK_EPSILON) {
    video.currentTime = targetTime;
  }
}

function canUseVideoClock() {
  return timeline.videoReady
    && !video.paused
    && !video.seeking
    && Number.isFinite(video.duration)
    && video.duration > 0;
}

function videoTimeToFrame(time) {
  return clampFrame(Math.floor(time * FRAME_RATE + 0.0001));
}

function frameToSeconds(frame) {
  return frame / FRAME_RATE;
}

function clampFrame(frame) {
  return clamp(frame, 0, Math.max(timeline.frameCount - 1, 0));
}

function wrapFrame(frame) {
  const frameCount = Math.max(timeline.frameCount, 1);
  return ((frame % frameCount) + frameCount) % frameCount;
}

function updateTimelineUi() {
  scrubber.value = String(timeline.frame);
  timelineTime.textContent = `${formatFrame(timeline.frame)} / ${formatFrame(Math.max(timeline.frameCount - 1, 0))}`;
}

function formatFrame(frame) {
  const maxDigits = String(Math.max(timeline.frameCount - 1, 0)).length;
  return `f${String(frame).padStart(Math.max(maxDigits, 4), '0')}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatStatus() {
  return latestFps > 0 ? `Ready / ${latestFps} fps` : 'Ready';
}

function registerAnimationTarget(id, { duration = 0, frameCount = 0, setTime }) {
  if (typeof setTime !== 'function') {
    return;
  }

  const nextTarget = {
    id,
    duration,
    frameCount,
    setTime,
  };
  const existingIndex = timeline.animationTargets.findIndex((target) => target.id === id);

  if (existingIndex >= 0) {
    timeline.animationTargets[existingIndex] = nextTarget;
  } else {
    timeline.animationTargets.push(nextTarget);
  }

  timeline.animationDuration = timeline.animationTargets.reduce(
    (longest, target) => Math.max(longest, target.duration ?? 0),
    0,
  );
  timeline.animationFrameCount = timeline.animationTargets.reduce(
    (longest, target) => Math.max(longest, target.frameCount ?? 0),
    0,
  );
  refreshTimelineBounds();
}

function hasAnimationTargets() {
  return timeline.animationTargets.length > 0;
}

function isBvhToggleShortcut(event) {
  return event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && !event.repeat
    && event.key.toLowerCase() === 'x'
    && !isTextInputTarget(event.target);
}

function isTextInputTarget(target) {
  const element = target instanceof HTMLElement ? target : null;

  if (!element) {
    return false;
  }

  const textInputTypes = new Set([
    'email',
    'number',
    'password',
    'search',
    'tel',
    'text',
    'url',
  ]);

  return element.isContentEditable
    || element.tagName === 'TEXTAREA'
    || (element.tagName === 'INPUT' && textInputTypes.has(element.type));
}

function setBvhVisualsVisible(isVisible) {
  bvhVisualsVisible = isVisible;
  bvhVisualToggle.textContent = bvhVisualsVisible ? 'BVH On' : 'BVH Off';
  bvhVisualToggle.setAttribute('aria-pressed', String(bvhVisualsVisible));
  applyDebugVisualVisibility();
  updateIkDebugStatus();
}

function setBodyAxisVisible(isVisible) {
  bodyAxisVisible = isVisible;
  bodyAxisToggle.textContent = bodyAxisVisible ? 'Body Axis On' : 'Body Axis Off';
  bodyAxisToggle.setAttribute('aria-pressed', String(bodyAxisVisible));
  applyDebugVisualVisibility();
  updateIkDebugStatus();
}

function setDebugPanelView(view) {
  activeDebugView = view;
  const isSphere = activeDebugView === 'sphere';

  debugDashboardTab.setAttribute('aria-pressed', String(!isSphere));
  trajectorySphereTab.setAttribute('aria-pressed', String(isSphere));
  debugDashboardView.hidden = isSphere;
  trajectorySphereView.hidden = !isSphere;
  trajectorySphere.setActive(isSphere);
  comStabilityUi.setActive(isSphere);
}

function applyDebugVisualVisibility() {
  if (!bvhIkRuntime) {
    bvhIkDebug.root.visible = bvhVisualsVisible || bodyAxisVisible;
    return;
  }

  bvhIkRuntime.setSkeletonVisible?.(bvhVisualsVisible);
  bvhIkRuntime.setBodyAxisVisible?.(bodyAxisVisible);
}

function updateIkDebugStatus() {
  if (!bvhIkRuntime) {
    ikDebugStatus.textContent = 'Loading BVH';
    return;
  }

  ikDebugStatus.textContent = `${bvhIkRuntime.metadata.frames}f / ${bvhIkRuntime.metadata.bones} bones / BVH ${bvhVisualsVisible ? 'on' : 'off'} / axis ${bodyAxisVisible ? 'on' : 'off'}`;
}

function updateIkDebugUi(frame, force = false) {
  if (!frame || (!force && frame.frameIndex === latestIkReadoutFrame)) {
    return;
  }

  latestIkReadoutFrame = frame.frameIndex;
  ikDebugReadout.textContent = formatIkDebugReadout(frame);
  trajectorySphere.setCurrentFrame(frame);
  comStabilityUi.setCurrentFrame(frame);
}

function prepareTrajectorySphere(runtime) {
  trajectorySphere.setStatus('Building sphere', 'Pelvis axes n/a');

  requestAnimationFrame(() => {
    try {
      const analysis = runtime.buildAnalysisFrames();
      const data = createFrameTrajectorySphereData(analysis, {
        label: 'Pelvis Axis Sphere',
        series: TRAJECTORY_SPHERE_SERIES,
      });

      trajectorySphere.setData(data);
      comStabilityUi.setData(createComSupportPhaseData(analysis.frames));
      trajectorySphere.setCurrentFrame(runtime.getCurrentFrame());
      comStabilityUi.setCurrentFrame(runtime.getCurrentFrame());
    } catch (error) {
      console.error(error);
      trajectorySphere.setStatus('Sphere failed', error.message);
    }
  });
}

function createFrameTrajectorySphereData(analysis, {
  label,
  series,
}) {
  const cycles = createGaitCycleSegments(analysis.frames, analysis.metadata);
  const trajectorySeries = series.map((definition) => {
    const points = analysis.frames
      .map((frame) => {
        const vector = extractFrameAxisVector(frame, definition.frameId, definition.axis);

        if (!vector) {
          return null;
        }

        return {
          cycleIndex: getGaitCycleIndex(cycles, frame.frame),
          frameIndex: frame.frame,
          time: frame.time,
          vector,
        };
      })
      .filter(Boolean);

    return {
      ...definition,
      cycleAverage: createTrajectoryCycleAverage(points, cycles),
      points,
    };
  });
  const trajectoryFrames = createTrajectoryFrameMap(trajectorySeries);

  return {
    cycles,
    frames: trajectoryFrames,
    label,
    series: trajectorySeries,
    totalFrames: analysis.metadata.frames,
  };
}

function createTrajectoryFrameMap(seriesList) {
  const frameMap = new Map();

  seriesList.forEach((series) => {
    series.points.forEach((point) => {
      const entry = frameMap.get(point.frameIndex) ?? {
        frameIndex: point.frameIndex,
        series: [],
      };

      entry.series.push({
        axis: series.axis,
        color: series.color,
        cycleIndex: point.cycleIndex,
        frameId: series.frameId,
        id: series.id,
        label: series.label,
        shortLabel: series.shortLabel,
        vector: point.vector,
      });
      frameMap.set(point.frameIndex, entry);
    });
  });

  return frameMap;
}

function createFrameTrajectorySphere({
  canvas: sphereCanvas,
  frameElement,
  vectorElement,
}) {
  const context = sphereCanvas.getContext('2d');
  const state = {
    active: false,
    current: null,
    currentFrameIndex: null,
    data: null,
  };

  return {
    resize: render,
    setActive(isActive) {
      state.active = isActive;
      render();
    },
    setCurrentFrame(frame) {
      const frameIndex = getFrameIndex(frame);
      const current = state.data?.frames?.get(frameIndex) ?? null;

      state.currentFrameIndex = frameIndex;
      state.current = current?.series?.length ? current : null;
      updateTrajectorySphereMeta(state, frameElement, vectorElement);
      render();
    },
    setData(data) {
      state.data = data;
      state.current = getPrecomputedTrajectoryFrame(state.data, state.currentFrameIndex);
      updateTrajectorySphereMeta(state, frameElement, vectorElement);
      render();
    },
    setStatus(frameText, vectorText) {
      frameElement.textContent = frameText;
      vectorElement.textContent = vectorText;
      render();
    },
  };

  function render() {
    if (!state.active || !context) {
      return;
    }

    const rect = sphereCanvas.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const deviceScale = window.devicePixelRatio || 1;
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    const pixelWidth = Math.floor(width * deviceScale);
    const pixelHeight = Math.floor(height * deviceScale);

    if (sphereCanvas.width !== pixelWidth || sphereCanvas.height !== pixelHeight) {
      sphereCanvas.width = pixelWidth;
      sphereCanvas.height = pixelHeight;
    }

    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
    drawFrameTrajectorySphere(context, {
      current: state.current,
      data: state.data,
      height,
      width,
    });
  }
}

function getPrecomputedTrajectoryFrame(data, frameIndex) {
  if (!data?.frames || !Number.isFinite(frameIndex)) {
    return null;
  }

  const current = data.frames.get(frameIndex);

  return current?.series?.length ? current : null;
}

function createComStabilityUi({
  canvas: stabilityCanvas,
  readoutElement,
  statusElement,
}) {
  const context = stabilityCanvas.getContext('2d');
  const state = {
    active: false,
    currentFrameIndex: null,
    data: null,
    lastRenderedFrame: null,
    stability: null,
  };

  return {
    resize: render,
    setActive(isActive) {
      state.active = isActive;
      render();
    },
    setData(data) {
      state.data = data;
      state.lastRenderedFrame = null;
      state.stability = getPrecomputedComStability(state.data, state.currentFrameIndex);
      updateComStabilityMeta(state.stability, statusElement, readoutElement);
      render();
    },
    setCurrentFrame(frame) {
      const frameIndex = getFrameIndex(frame);

      state.currentFrameIndex = frameIndex;
      state.stability = getPrecomputedComStability(state.data, frameIndex);
      updateComStabilityMeta(state.stability, statusElement, readoutElement);

      if (
        state.active
        && state.lastRenderedFrame !== null
        && Number.isFinite(frameIndex)
        && Math.abs(frameIndex - state.lastRenderedFrame) < COM_STABILITY_RENDER_FRAME_STEP
      ) {
        return;
      }

      state.lastRenderedFrame = Number.isFinite(frameIndex) ? frameIndex : null;
      render();
    },
  };

  function render() {
    if (!state.active || !context) {
      return;
    }

    const rect = stabilityCanvas.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const deviceScale = window.devicePixelRatio || 1;
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    const pixelWidth = Math.floor(width * deviceScale);
    const pixelHeight = Math.floor(height * deviceScale);

    if (stabilityCanvas.width !== pixelWidth || stabilityCanvas.height !== pixelHeight) {
      stabilityCanvas.width = pixelWidth;
      stabilityCanvas.height = pixelHeight;
    }

    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
    drawComStability(context, state.stability, width, height);
  }
}

function getFrameIndex(frame) {
  const frameIndex = frame?.frameIndex ?? frame?.frame;

  return Number.isFinite(frameIndex) ? frameIndex : null;
}

function getPrecomputedComStability(data, frameIndex) {
  if (!data?.frames || !Number.isFinite(frameIndex)) {
    return null;
  }

  return data.frames.get(frameIndex) ?? null;
}

function calculateComStability(frame, supportFrame) {
  const estimatedCom = estimateBodyCom(frame);
  const com = toGroundPoint(estimatedCom);
  const leftFoot = createFootSupportPatch(getFrameTarget(frame, 'leftFoot'), supportFrame?.leftSupport);
  const rightFoot = createFootSupportPatch(getFrameTarget(frame, 'rightFoot'), supportFrame?.rightSupport);
  const supportPoints = [
    ...leftFoot.points,
    ...rightFoot.points,
  ];
  const supportPolygon = supportPoints.length >= 3 ? convexHull2d(supportPoints) : [];
  const isStable = Boolean(com && supportPolygon.length >= 3 && pointInPolygon2d(com, supportPolygon));
  const bounds = createGroundBounds(com, supportPoints);

  return {
    bounds,
    com,
    comHeight: Number(estimatedCom?.y) || 0,
    contacts: {
      left: leftFoot.contact,
      right: rightFoot.contact,
    },
    method: supportFrame?.method ?? 'kinematic',
    supportScore: supportFrame?.score ?? null,
    isStable,
    supportPolygon,
    supportPoints,
  };
}

function getFrameTarget(frame, targetId) {
  return frame?.targets?.[targetId] ?? frame?.ikTargets?.[targetId] ?? null;
}

function createGroundBounds(com, supportPoints) {
  const allPoints = [
    com,
    ...supportPoints,
  ].filter(Boolean);

  if (!allPoints.length) {
    return null;
  }

  return allPoints.reduce((box, point) => ({
    maxX: Math.max(box.maxX, point.x),
    maxZ: Math.max(box.maxZ, point.z),
    minX: Math.min(box.minX, point.x),
    minZ: Math.min(box.minZ, point.z),
  }), {
    maxX: -Infinity,
    maxZ: -Infinity,
    minX: Infinity,
    minZ: Infinity,
  });
}

function createFootSupportPatch(target, isSupport) {
  if (!isSupport || !target?.position) {
    return {
      contact: false,
      points: [],
    };
  }

  const foot = toGroundPoint(target.position);
  const toe = toGroundPoint(target.toePosition) ?? foot;

  if (!foot) {
    return {
      contact: false,
      points: [],
    };
  }

  const forward = normalize2d({
    x: toe.x - foot.x,
    z: toe.z - foot.z,
  }) ?? { x: 0, z: 1 };
  const lateral = {
    x: -forward.z,
    z: forward.x,
  };
  const heel = add2d(foot, scale2d(forward, -COM_SUPPORT_HEEL_EXTENSION));
  const toeTip = add2d(toe, scale2d(forward, COM_SUPPORT_TOE_EXTENSION));
  const side = scale2d(lateral, COM_SUPPORT_FOOT_HALF_WIDTH);

  return {
    contact: true,
    points: [
      add2d(heel, side),
      add2d(toeTip, side),
      add2d(toeTip, scale2d(side, -1)),
      add2d(heel, scale2d(side, -1)),
    ],
  };
}

function estimateBodyCom(frame) {
  const accumulator = {
    weight: 0,
    x: 0,
    y: 0,
    z: 0,
  };
  const leftArm = getFrameTarget(frame, 'leftHand');
  const rightArm = getFrameTarget(frame, 'rightHand');
  const leftLeg = getFrameTarget(frame, 'leftFoot');
  const rightLeg = getFrameTarget(frame, 'rightFoot');
  const root = frame?.root?.position;
  const shoulderCenter = averageVectors([
    leftArm?.rootPosition,
    rightArm?.rootPosition,
  ]);

  if (root && shoulderCenter) {
    addWeightedVector(accumulator, lerpVector(root, shoulderCenter, 0.52), 0.5);
  } else if (root) {
    addWeightedVector(accumulator, root, 0.5);
  }

  addLimbSegments(accumulator, leftArm, {
    distal: 0.006,
    lower: 0.016,
    upper: 0.028,
  });
  addLimbSegments(accumulator, rightArm, {
    distal: 0.006,
    lower: 0.016,
    upper: 0.028,
  });
  addLimbSegments(accumulator, leftLeg, {
    distal: 0.015,
    lower: 0.046,
    upper: 0.1,
  });
  addLimbSegments(accumulator, rightLeg, {
    distal: 0.015,
    lower: 0.046,
    upper: 0.1,
  });

  if (accumulator.weight <= 0) {
    return root ?? null;
  }

  return {
    x: accumulator.x / accumulator.weight,
    y: accumulator.y / accumulator.weight,
    z: accumulator.z / accumulator.weight,
  };
}

function addLimbSegments(accumulator, target, weights) {
  if (!target?.rootPosition || !target.midPosition || !target.position) {
    return;
  }

  addWeightedVector(accumulator, midpointVector(target.rootPosition, target.midPosition), weights.upper);
  addWeightedVector(accumulator, midpointVector(target.midPosition, target.position), weights.lower);

  if (target.toePosition) {
    addWeightedVector(accumulator, midpointVector(target.position, target.toePosition), weights.distal);
  } else {
    addWeightedVector(accumulator, target.position, weights.distal);
  }
}

function addWeightedVector(accumulator, vector, weight) {
  if (!vector || weight <= 0) {
    return;
  }

  accumulator.x += vector.x * weight;
  accumulator.y += vector.y * weight;
  accumulator.z += vector.z * weight;
  accumulator.weight += weight;
}

function averageVectors(vectors) {
  const validVectors = vectors.filter(Boolean);

  if (!validVectors.length) {
    return null;
  }

  return {
    x: validVectors.reduce((sum, vector) => sum + vector.x, 0) / validVectors.length,
    y: validVectors.reduce((sum, vector) => sum + vector.y, 0) / validVectors.length,
    z: validVectors.reduce((sum, vector) => sum + vector.z, 0) / validVectors.length,
  };
}

function midpointVector(a, b) {
  return lerpVector(a, b, 0.5);
}

function lerpVector(a, b, t) {
  return {
    x: THREE.MathUtils.lerp(a.x, b.x, t),
    y: THREE.MathUtils.lerp(a.y, b.y, t),
    z: THREE.MathUtils.lerp(a.z, b.z, t),
  };
}

function updateComStabilityMeta(stability, statusElement, readoutElement) {
  if (!stability?.com) {
    statusElement.textContent = 'COM n/a';
    statusElement.style.color = '#f4f6ef';
    readoutElement.textContent = 'COM n/a';
    return;
  }

  const hasSupport = stability.supportPolygon.length >= 3;
  const statusText = hasSupport
    ? (stability.isStable ? 'Stable' : 'Outside')
    : 'No support';
  const statusColor = hasSupport
    ? (stability.isStable ? '#58d86f' : '#ff4d4d')
    : '#ffd166';

  statusElement.textContent = statusText;
  statusElement.style.color = statusColor;
  readoutElement.textContent = [
    `eCOM xz ${formatNumber(stability.com.x)}, ${formatNumber(stability.com.z)}`,
    `support L ${stability.contacts.left ? 'yes' : 'no'} / R ${stability.contacts.right ? 'yes' : 'no'}`,
    `logic ${stability.method}`,
  ].join('\n');
}

function drawComStability(context, stability, width, height) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = 'rgba(5, 6, 4, 0.72)';
  context.fillRect(0, 0, width, height);

  if (!stability?.com) {
    drawTrajectorySphereMessage(context, { x: width / 2, y: height / 2 }, 'COM n/a');
    return;
  }

  const mapper = createGroundMapper(stability, width, height);
  const stableColor = stability.isStable ? '#58d86f' : '#ff4d4d';

  drawComGrid(context, width, height);
  drawSupportPolygon(context, stability.supportPolygon, mapper, stableColor);
  drawSupportPoints(context, stability.supportPoints, mapper);
  drawComProjection(context, stability, mapper, stableColor);
}

function createGroundMapper(stability, width, height) {
  const bounds = stability.bounds ?? createGroundBounds(stability.com, stability.supportPoints);

  if (!bounds) {
    return (point) => ({
      x: width * 0.5 + (point?.x ?? 0),
      y: height * 0.5 - (point?.z ?? 0),
    });
  }

  const rangeX = Math.max(bounds.maxX - bounds.minX, 0.35);
  const rangeZ = Math.max(bounds.maxZ - bounds.minZ, 0.35);
  const padding = 26;
  const scale = Math.min(
    (width - padding * 2) / rangeX,
    (height - padding * 2) / rangeZ,
  );
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;

  return (point) => ({
    x: width * 0.5 + (point.x - centerX) * scale,
    y: height * 0.5 - (point.z - centerZ) * scale,
  });
}

function drawComGrid(context, width, height) {
  context.strokeStyle = 'rgba(244, 246, 239, 0.08)';
  context.lineWidth = 1;

  for (let x = 20; x < width; x += 26) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let y = 20; y < height; y += 26) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function drawSupportPolygon(context, polygon, mapper, color) {
  if (polygon.length < 3) {
    return;
  }

  context.fillStyle = hexToRgba(color, 0.18);
  context.strokeStyle = color;
  context.globalAlpha = 0.92;
  context.lineWidth = 1.5;
  context.beginPath();

  polygon.forEach((point, index) => {
    const screen = mapper(point);

    if (index === 0) {
      context.moveTo(screen.x, screen.y);
    } else {
      context.lineTo(screen.x, screen.y);
    }
  });

  context.closePath();
  context.fill();
  context.stroke();
  context.globalAlpha = 1;
}

function drawSupportPoints(context, points, mapper) {
  context.fillStyle = 'rgba(244, 246, 239, 0.78)';

  points.forEach((point) => {
    const screen = mapper(point);

    context.beginPath();
    context.arc(screen.x, screen.y, 2.2, 0, Math.PI * 2);
    context.fill();
  });
}

function drawComProjection(context, stability, mapper, color) {
  const projection = mapper(stability.com);
  const ballY = projection.y - THREE.MathUtils.clamp(stability.comHeight * 12, 8, 22);
  const gradient = context.createRadialGradient(
    projection.x - 3,
    ballY - 4,
    1,
    projection.x,
    ballY,
    9,
  );

  context.setLineDash([4, 4]);
  context.strokeStyle = hexToRgba(color, 0.72);
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(projection.x, ballY);
  context.lineTo(projection.x, projection.y);
  context.stroke();
  context.setLineDash([]);

  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(projection.x, projection.y, 6, 0, Math.PI * 2);
  context.stroke();

  gradient.addColorStop(0, '#f4f6ef');
  gradient.addColorStop(1, color);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(projection.x, ballY, 7.5, 0, Math.PI * 2);
  context.fill();
}

function updateTrajectorySphereMeta(state, frameElement, vectorElement) {
  const pointCount = getTrajectorySpherePointCount(state.data);
  const current = state.current;

  if (!state.data) {
    frameElement.textContent = 'Waiting for BVH';
    vectorElement.textContent = 'Pelvis axes n/a';
    return;
  }

  frameElement.textContent = current?.frameIndex !== null && current?.frameIndex !== undefined
    ? `${formatFrame(current.frameIndex)} / ${pointCount} pts / ${state.data.cycles.length} cycles`
    : `${pointCount} pts`;
  vectorElement.textContent = current?.series?.length
    ? current.series
      .map((series) => `${series.shortLabel} ${formatTrajectoryVector(series.vector)}`)
      .join('\n')
    : 'Pelvis axes n/a';
}

function drawFrameTrajectorySphere(context, {
  current,
  data,
  height,
  width,
}) {
  const center = {
    x: width * 0.5,
    y: height * 0.48,
  };
  const radius = Math.max(70, Math.min(width, height) * 0.39);

  context.clearRect(0, 0, width, height);
  drawTrajectorySphereBase(context, center, radius);

  const seriesList = data?.series?.filter((series) => series.points.length) ?? [];

  if (!seriesList.length) {
    drawTrajectorySphereMessage(context, center, 'No trajectory data');
    return;
  }

  drawTrajectoryDensityMap(context, seriesList, center, radius);

  seriesList.forEach((series) => {
    drawTrajectoryVarianceBand(context, series, center, radius);
  });

  seriesList.forEach((series) => {
    drawTrajectorySphereCyclePath(context, series, data.cycles, center, radius);
  });

  seriesList.forEach((series) => {
    drawTrajectoryMeanPath(context, series, center, radius);
  });

  current?.series?.forEach((series) => {
    drawTrajectorySphereCurrentPoint(context, series, center, radius);
  });

  if (data?.series?.length) {
    drawTrajectorySphereLegend(context, data, width);
  }
}

function drawTrajectorySphereBase(context, center, radius) {
  const sphereGradient = context.createRadialGradient(
    center.x - radius * 0.24,
    center.y - radius * 0.3,
    radius * 0.1,
    center.x,
    center.y,
    radius,
  );

  sphereGradient.addColorStop(0, 'rgba(244, 246, 239, 0.16)');
  sphereGradient.addColorStop(1, 'rgba(77, 141, 255, 0.05)');

  context.fillStyle = sphereGradient;
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = 'rgba(244, 246, 239, 0.22)';
  context.lineWidth = 1;
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.stroke();

  drawProjectedAxis(context, center, radius, { x: 1, y: 0, z: 0 }, 'LR', '#ff4d4d');
  drawProjectedAxis(context, center, radius, { x: 0, y: 1, z: 0 }, 'Up', '#58d86f');
  drawProjectedAxis(context, center, radius, { x: 0, y: 0, z: 1 }, 'Fwd', '#4d8dff');
}

function drawProjectedAxis(context, center, radius, vector, label, color) {
  const projected = projectUnitVectorToTrajectorySphere(vector);
  const end = toSphereCanvasPoint(projected, center, radius);

  context.strokeStyle = color;
  context.globalAlpha = 0.58;
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(center.x, center.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.globalAlpha = 1;

  context.fillStyle = color;
  context.font = '800 10px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, end.x, end.y);
}

function drawTrajectoryDensityMap(context, seriesList, center, radius) {
  const stampRadius = Math.max(8, radius * 0.055);

  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.clip();
  context.globalCompositeOperation = 'lighter';

  seriesList.forEach((series) => {
    series.points.forEach((point) => {
      const projected = toSphereCanvasPoint(
        projectUnitVectorToTrajectorySphere(point.vector),
        center,
        radius,
      );
      const gradient = context.createRadialGradient(
        projected.x,
        projected.y,
        0,
        projected.x,
        projected.y,
        stampRadius,
      );

      gradient.addColorStop(0, 'rgba(244, 246, 239, 0.055)');
      gradient.addColorStop(0.38, hexToRgba(series.color, 0.018));
      gradient.addColorStop(1, hexToRgba(series.color, 0));

      context.fillStyle = gradient;
      context.beginPath();
      context.arc(projected.x, projected.y, stampRadius, 0, Math.PI * 2);
      context.fill();
    });
  });

  context.restore();
}

function drawTrajectoryVarianceBand(context, series, center, radius) {
  const samples = series.cycleAverage?.samples ?? [];

  if (!samples.length) {
    return;
  }

  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.clip();

  samples.forEach((sample) => {
    const projected = toSphereCanvasPoint(
      projectUnitVectorToTrajectorySphere(sample.vector),
      center,
      radius,
    );
    const bandRadius = THREE.MathUtils.clamp(
      sample.spreadRad * radius * TRAJECTORY_VARIANCE_BAND_SCALE,
      2,
      18,
    );
    const gradient = context.createRadialGradient(
      projected.x,
      projected.y,
      0,
      projected.x,
      projected.y,
      bandRadius,
    );

    gradient.addColorStop(0, hexToRgba(series.color, 0.13));
    gradient.addColorStop(1, hexToRgba(series.color, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(projected.x, projected.y, bandRadius, 0, Math.PI * 2);
    context.fill();
  });

  context.restore();
}

function drawTrajectorySphereCyclePath(context, series, cycles, center, radius) {
  let activeCycleIndex = null;
  let hasActivePath = false;

  context.globalAlpha = 0.56;
  context.lineWidth = 0.7;

  series.points.forEach((point) => {
    const cycle = cycles[point.cycleIndex] ?? cycles[0];
    const projected = toSphereCanvasPoint(
      projectUnitVectorToTrajectorySphere(point.vector),
      center,
      radius,
    );

    if (activeCycleIndex !== point.cycleIndex) {
      if (hasActivePath) {
        context.stroke();
      }

      activeCycleIndex = point.cycleIndex;
      hasActivePath = true;
      context.strokeStyle = cycle?.color ?? series.color;
      context.beginPath();
      context.moveTo(projected.x, projected.y);
      return;
    }

    context.lineTo(projected.x, projected.y);
  });

  if (hasActivePath) {
    context.stroke();
  }

  context.globalAlpha = 1;
}

function drawTrajectoryMeanPath(context, series, center, radius) {
  const samples = series.cycleAverage?.samples ?? [];

  if (samples.length < 2) {
    return;
  }

  context.strokeStyle = series.color;
  context.globalAlpha = 0.95;
  context.lineWidth = 1.9;
  context.beginPath();

  samples.forEach((sample, index) => {
    const projected = toSphereCanvasPoint(
      projectUnitVectorToTrajectorySphere(sample.vector),
      center,
      radius,
    );

    if (index === 0) {
      context.moveTo(projected.x, projected.y);
    } else {
      context.lineTo(projected.x, projected.y);
    }
  });

  context.stroke();
  context.globalAlpha = 1;
}

function drawTrajectorySphereCurrentPoint(context, series, center, radius) {
  const projected = toSphereCanvasPoint(
    projectUnitVectorToTrajectorySphere(series.vector),
    center,
    radius,
  );

  context.fillStyle = '#f4f6ef';
  context.strokeStyle = series.color;
  context.lineWidth = 2.2;
  context.beginPath();
  context.arc(projected.x, projected.y, 5.5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function drawTrajectorySphereLegend(context, data, width) {
  const seriesList = data.series;
  const cycleList = data.cycles.slice(0, 4);
  const padding = 8;
  const rowHeight = 15;
  const sectionGap = 6;
  const boxWidth = 92;
  const boxHeight = padding * 2
    + seriesList.length * rowHeight
    + sectionGap
    + cycleList.length * rowHeight
    + (data.cycles.length > cycleList.length ? rowHeight : 0);
  const x = width - boxWidth - 10;
  const y = 10;

  context.fillStyle = 'rgba(5, 6, 4, 0.58)';
  drawCanvasRoundRect(context, x, y, boxWidth, boxHeight, 6);
  context.fill();
  context.strokeStyle = 'rgba(244, 246, 239, 0.12)';
  context.lineWidth = 1;
  context.stroke();

  context.font = '800 10px Inter, Arial, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';

  seriesList.forEach((series, index) => {
    const cy = y + padding + index * rowHeight + rowHeight * 0.5;

    context.fillStyle = series.color;
    context.beginPath();
    context.arc(x + 12, cy, 3, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(244, 246, 239, 0.82)';
    context.fillText(series.shortLabel, x + 22, cy);
  });

  const cycleStartY = y + padding + seriesList.length * rowHeight + sectionGap;

  cycleList.forEach((cycle, index) => {
    const cy = cycleStartY + index * rowHeight + rowHeight * 0.5;

    context.strokeStyle = cycle.color;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x + 8, cy);
    context.lineTo(x + 18, cy);
    context.stroke();
    context.fillStyle = 'rgba(244, 246, 239, 0.82)';
    context.fillText(cycle.label, x + 22, cy);
  });

  if (data.cycles.length > cycleList.length) {
    const cy = cycleStartY + cycleList.length * rowHeight + rowHeight * 0.5;

    context.fillStyle = 'rgba(244, 246, 239, 0.58)';
    context.fillText(`+${data.cycles.length - cycleList.length}`, x + 22, cy);
  }
}

function drawCanvasRoundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawTrajectorySphereMessage(context, center, message) {
  context.fillStyle = 'rgba(244, 246, 239, 0.62)';
  context.font = '800 12px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(message, center.x, center.y);
}

function extractFrameAxisVector(frame, frameId, axis) {
  return normalizeTrajectoryVector(frame?.anatomicalFrames?.[frameId]?.axes?.[axis]);
}

function createComSupportPhaseData(frames) {
  const leftMetrics = createFootSupportMetrics(frames, 'leftFoot');
  const rightMetrics = createFootSupportMetrics(frames, 'rightFoot');
  const frameMap = new Map();

  frames.forEach((frame, index) => {
    const left = leftMetrics[index];
    const right = rightMetrics[index];
    let leftSupport = isKinematicSupport(left);
    let rightSupport = isKinematicSupport(right);
    let method = 'kinematic low+slow';

    if (!leftSupport && !rightSupport) {
      const fallback = chooseFallbackSupport(left, right);

      if (fallback === 'left') {
        leftSupport = true;
      } else if (fallback === 'right') {
        rightSupport = true;
      }

      if (fallback) {
        method = 'kinematic fallback';
      }
    }

    const stability = calculateComStability(frame, {
      leftSupport,
      method,
      rightSupport,
      score: {
        left: left?.score ?? null,
        right: right?.score ?? null,
      },
    });
    const frameIndex = getFrameIndex(frame);

    if (Number.isFinite(frameIndex)) {
      frameMap.set(frameIndex, stability);
    }
  });

  return {
    frameCount: frameMap.size,
    frames: frameMap,
  };
}

function createFootSupportMetrics(frames, targetId) {
  const raw = frames.map((frame, index) => {
    const target = getFrameTarget(frame, targetId);
    const center = getFootSupportCenter(target);
    const lowestY = getFootLowestY(target);
    const previousCenter = index > 0 ? getFootSupportCenter(getFrameTarget(frames[index - 1], targetId)) : null;
    const dt = index > 0 ? Math.max(frame.time - frames[index - 1].time, 0.000001) : 1;
    const speed = center && previousCenter ? distance3d(center, previousCenter) / dt : 0;

    return {
      center,
      frame: frame.frame,
      lowestY,
      speed,
    };
  });
  const heights = raw.map((item) => item.lowestY).filter(Number.isFinite);
  const speeds = raw.map((item) => item.speed).filter(Number.isFinite);
  const lowHeight = percentileNumber(heights, 0.06);
  const highHeight = percentileNumber(heights, 0.94);
  const supportHeight = percentileNumber(heights, COM_SUPPORT_HEIGHT_QUANTILE);
  const supportSpeed = percentileNumber(speeds, COM_SUPPORT_SPEED_QUANTILE);
  const heightRange = Math.max(highHeight - lowHeight, 0.000001);

  return raw.map((item) => {
    const heightNorm = Number.isFinite(item.lowestY)
      ? THREE.MathUtils.clamp((item.lowestY - lowHeight) / heightRange, 0, 1)
      : 1;
    const speedNorm = Number.isFinite(item.speed) && Number.isFinite(supportSpeed) && supportSpeed > 0
      ? THREE.MathUtils.clamp(item.speed / supportSpeed, 0, 2)
      : 0;

    return {
      ...item,
      heightNorm,
      score: heightNorm * 0.72 + Math.min(speedNorm, 1) * 0.28,
      supportHeight,
      supportSpeed,
    };
  });
}

function isKinematicSupport(metric) {
  return Boolean(metric)
    && Number.isFinite(metric.lowestY)
    && metric.lowestY <= metric.supportHeight
    && metric.score <= 0.82;
}

function chooseFallbackSupport(left, right) {
  const candidates = [
    ['left', left],
    ['right', right],
  ].filter(([, metric]) => metric && Number.isFinite(metric.score));

  if (!candidates.length) {
    return null;
  }

  candidates.sort(([, a], [, b]) => {
    const aLikelySupport = a.heightNorm <= COM_SUPPORT_FALLBACK_HEIGHT_NORM ? 0 : 1;
    const bLikelySupport = b.heightNorm <= COM_SUPPORT_FALLBACK_HEIGHT_NORM ? 0 : 1;

    return aLikelySupport - bLikelySupport || a.score - b.score;
  });
  return candidates[0][0];
}

function getFootSupportCenter(target) {
  if (!target?.position) {
    return null;
  }

  return target.toePosition
    ? midpointVector(target.position, target.toePosition)
    : target.position;
}

function getFootLowestY(target) {
  if (!target?.position) {
    return null;
  }

  return target.toePosition
    ? Math.min(target.position.y, target.toePosition.y)
    : target.position.y;
}

function distance3d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function percentileNumber(values, amount) {
  const finiteValues = values.filter(Number.isFinite).sort((a, b) => a - b);

  if (!finiteValues.length) {
    return 0;
  }

  const index = clamp(
    Math.round((finiteValues.length - 1) * amount),
    0,
    finiteValues.length - 1,
  );

  return finiteValues[index];
}

function toGroundPoint(vector) {
  if (!vector) {
    return null;
  }

  const x = Number(vector.x);
  const z = Number(vector.z);

  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }

  return { x, z };
}

function add2d(a, b) {
  return {
    x: a.x + b.x,
    z: a.z + b.z,
  };
}

function scale2d(vector, scale) {
  return {
    x: vector.x * scale,
    z: vector.z * scale,
  };
}

function normalize2d(vector) {
  const length = Math.hypot(vector.x, vector.z);

  if (!Number.isFinite(length) || length <= 0.000001) {
    return null;
  }

  return {
    x: vector.x / length,
    z: vector.z / length,
  };
}

function convexHull2d(points) {
  if (points.length <= 3) {
    return points;
  }

  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.z - b.z : a.x - b.x));
  const lower = [];
  const upper = [];

  sorted.forEach((point) => {
    while (lower.length >= 2 && cross2d(lower.at(-2), lower.at(-1), point) <= 0) {
      lower.pop();
    }

    lower.push(point);
  });

  [...sorted].reverse().forEach((point) => {
    while (upper.length >= 2 && cross2d(upper.at(-2), upper.at(-1), point) <= 0) {
      upper.pop();
    }

    upper.push(point);
  });

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function cross2d(origin, a, b) {
  return (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
}

function pointInPolygon2d(point, polygon) {
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const intersects = ((a.z > point.z) !== (b.z > point.z))
      && (point.x < ((b.x - a.x) * (point.z - a.z)) / ((b.z - a.z) || 0.000001) + a.x);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function createGaitCycleSegments(frames, metadata) {
  const firstFrame = frames[0]?.frame ?? 0;
  const lastFrame = frames.at(-1)?.frame ?? firstFrame;
  const sampleRate = metadata?.sampleRate ?? 30;
  const minSeparation = Math.max(10, Math.round(sampleRate * 0.42));
  const starts = [firstFrame];
  let previousContact = Boolean(frames[0]?.gaitAngles?.left?.contact);
  let lastStart = firstFrame;

  frames.slice(1).forEach((frame) => {
    const contact = Boolean(frame.gaitAngles?.left?.contact);
    const isHeelStrike = contact && !previousContact;

    if (isHeelStrike && frame.frame - lastStart >= minSeparation) {
      starts.push(frame.frame);
      lastStart = frame.frame;
    }

    previousContact = contact;
  });

  return starts.map((startFrame, index) => ({
    color: TRAJECTORY_CYCLE_COLORS[index % TRAJECTORY_CYCLE_COLORS.length],
    endFrame: (starts[index + 1] ?? lastFrame + 1) - 1,
    index,
    label: `C${index + 1}`,
    startFrame,
  }));
}

function getGaitCycleIndex(cycles, frameIndex) {
  const cycle = cycles.find((item) => frameIndex >= item.startFrame && frameIndex <= item.endFrame);

  return cycle?.index ?? 0;
}

function createTrajectoryCycleAverage(points, cycles) {
  const cyclePointSets = cycles
    .map((cycle) => ({
      cycle,
      points: points
        .filter((point) => point.frameIndex >= cycle.startFrame && point.frameIndex <= cycle.endFrame)
        .sort((a, b) => a.frameIndex - b.frameIndex),
    }))
    .filter((item) => item.points.length >= 2);

  if (!cyclePointSets.length) {
    return {
      samples: [],
    };
  }

  const samples = Array.from({ length: TRAJECTORY_PHASE_SAMPLES }, (_, index) => {
    const phase = TRAJECTORY_PHASE_SAMPLES <= 1
      ? 0
      : index / (TRAJECTORY_PHASE_SAMPLES - 1);
    const vectors = cyclePointSets
      .map(({ cycle, points: cyclePoints }) => sampleTrajectoryCycleVector(cyclePoints, cycle, phase))
      .filter(Boolean);
    const meanVector = averageUnitVectors(vectors);

    if (!meanVector) {
      return null;
    }

    const spreadRad = Math.sqrt(
      vectors.reduce((sum, vector) => sum + angularDistanceRad(vector, meanVector) ** 2, 0)
        / Math.max(vectors.length, 1),
    );

    return {
      phase,
      sampleCount: vectors.length,
      spreadRad,
      vector: meanVector,
    };
  }).filter(Boolean);

  return {
    cycleCount: cyclePointSets.length,
    samples,
  };
}

function sampleTrajectoryCycleVector(points, cycle, phase) {
  const targetFrame = cycle.startFrame + (cycle.endFrame - cycle.startFrame) * phase;

  if (targetFrame <= points[0].frameIndex) {
    return points[0].vector;
  }

  const lastPoint = points.at(-1);

  if (targetFrame >= lastPoint.frameIndex) {
    return lastPoint.vector;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];

    if (targetFrame <= next.frameIndex) {
      const span = next.frameIndex - previous.frameIndex;
      const t = span > 0 ? (targetFrame - previous.frameIndex) / span : 0;

      return normalizeTrajectoryVector({
        x: THREE.MathUtils.lerp(previous.vector.x, next.vector.x, t),
        y: THREE.MathUtils.lerp(previous.vector.y, next.vector.y, t),
        z: THREE.MathUtils.lerp(previous.vector.z, next.vector.z, t),
      });
    }
  }

  return lastPoint.vector;
}

function averageUnitVectors(vectors) {
  if (!vectors.length) {
    return null;
  }

  const sum = vectors.reduce((accumulator, vector) => ({
    x: accumulator.x + vector.x,
    y: accumulator.y + vector.y,
    z: accumulator.z + vector.z,
  }), { x: 0, y: 0, z: 0 });
  const mean = normalizeTrajectoryVector(sum);

  return mean ?? vectors[0];
}

function angularDistanceRad(a, b) {
  return Math.acos(THREE.MathUtils.clamp(
    a.x * b.x + a.y * b.y + a.z * b.z,
    -1,
    1,
  ));
}

function normalizeTrajectoryVector(vector) {
  if (!vector) {
    return null;
  }

  const x = Number(vector.x);
  const y = Number(vector.y);
  const z = Number(vector.z);
  const length = Math.hypot(x, y, z);

  if (!Number.isFinite(length) || length <= 0.000001) {
    return null;
  }

  return {
    x: x / length,
    y: y / length,
    z: z / length,
  };
}

function getTrajectorySpherePointCount(data) {
  return data?.series?.reduce(
    (largest, series) => Math.max(largest, series.points.length),
    0,
  ) ?? 0;
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;

  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function projectUnitVectorToTrajectorySphere(vector) {
  const yawCos = Math.cos(TRAJECTORY_SPHERE_VIEW.yaw);
  const yawSin = Math.sin(TRAJECTORY_SPHERE_VIEW.yaw);
  const pitchCos = Math.cos(TRAJECTORY_SPHERE_VIEW.pitch);
  const pitchSin = Math.sin(TRAJECTORY_SPHERE_VIEW.pitch);
  const x1 = vector.x * yawCos + vector.z * yawSin;
  const z1 = -vector.x * yawSin + vector.z * yawCos;
  const y2 = vector.y * pitchCos - z1 * pitchSin;
  const z2 = vector.y * pitchSin + z1 * pitchCos;

  return {
    depth: z2,
    x: x1,
    y: y2,
  };
}

function toSphereCanvasPoint(projected, center, radius) {
  return {
    x: center.x + projected.x * radius,
    y: center.y - projected.y * radius,
  };
}

function formatTrajectoryVector(vector) {
  return `${vector.x.toFixed(3)}, ${vector.y.toFixed(3)}, ${vector.z.toFixed(3)}`;
}

function formatIkDebugReadout(frame) {
  const left = frame.gaitAngles.left;
  const right = frame.gaitAngles.right;

  return [
    'BVH',
    `frame ${formatFrame(frame.frameIndex)} / ${formatFrame(Math.max(frame.frameCount - 1, 0))}`,
    `time  ${frame.time.toFixed(3)}s / ${formatSeconds(frame.metadata.duration)}`,
    `rate  ${frame.metadata.sampleRate.toFixed(2)} fps`,
    `bones ${frame.metadata.bones}   channels ${frame.metadata.channels}`,
    `foot floor L ${formatNumber(frame.contactBaselines.leftFoot)}  R ${formatNumber(frame.contactBaselines.rightFoot)}`,
    '',
    'Root',
    `pos   ${formatVector(frame.root.position)}`,
    `rot   ${formatEulerRadians(frame.root.euler)}`,
    `raw   ${formatChannels(frame.bvhChannels.Hips?.channels)}`,
    '',
    'Gait Angles',
    formatSideAngles('L', left),
    formatSideAngles('R', right),
    '',
    'Anatomical Joint Angles',
    formatAnatomicalSide('L', frame.anatomicalJointAngles.left),
    formatAnatomicalSide('R', frame.anatomicalJointAngles.right),
    '',
    'Anatomical Frames',
    formatAnatomicalFrame('Pelvis', frame.anatomicalFrames.pelvis),
    formatAnatomicalFrame('L femur', frame.anatomicalFrames.leftFemur),
    formatAnatomicalFrame('L tibia', frame.anatomicalFrames.leftTibia),
    formatAnatomicalFrame('L foot', frame.anatomicalFrames.leftFoot),
    formatAnatomicalFrame('R femur', frame.anatomicalFrames.rightFemur),
    formatAnatomicalFrame('R tibia', frame.anatomicalFrames.rightTibia),
    formatAnatomicalFrame('R foot', frame.anatomicalFrames.rightFoot),
    '',
    'IK Targets',
    formatTarget('L hand', frame.targets.leftHand),
    formatTarget('R hand', frame.targets.rightHand),
    formatTarget('L foot', frame.targets.leftFoot),
    formatTarget('R foot', frame.targets.rightFoot),
    '',
    'IK Poles',
    formatPole('L elbow', frame.poles.leftElbow),
    formatPole('R elbow', frame.poles.rightElbow),
    formatPole('L knee', frame.poles.leftKnee),
    formatPole('R knee', frame.poles.rightKnee),
    '',
    'Raw BVH Channels',
    ...DEBUG_JOINTS.map((joint) => `${padLabel(joint)} ${formatChannels(frame.bvhChannels[joint]?.channels)}`),
    '',
    'Local Euler XYZ',
    ...DEBUG_LOCAL_ROTATION_JOINTS.map((joint) => (
      `${padLabel(joint)} ${formatEulerDeg(frame.jointRotations[joint]?.eulerDeg)}`
    )),
  ].join('\n');
}

function formatAnatomicalSide(label, sideAngles) {
  if (!sideAngles) {
    return `${label} anatomical n/a`;
  }

  return [
    `${label} hip ${formatAnatomicalJoint(sideAngles.hip)}`,
    `${label} knee ${formatAnatomicalJoint(sideAngles.knee)}`,
    `${label} ankle ${formatAnatomicalJoint(sideAngles.ankle)}`,
  ].join('\n');
}

function formatAnatomicalJoint(angles) {
  if (!angles) {
    return 'n/a';
  }

  return [
    `FE ${formatDeg(angles.flexionExtensionDeg)}`,
    `AA ${formatDeg(angles.abductionAdductionDeg)}`,
    `IE ${formatDeg(angles.internalExternalRotationDeg)}`,
  ].join('  ');
}

function formatAnatomicalFrame(label, anatomicalFrame) {
  if (!anatomicalFrame) {
    return `${padLabel(label)} n/a`;
  }

  return [
    `${padLabel(label)} O ${formatVector(anatomicalFrame.origin)}`,
    `  X ${formatVector(anatomicalFrame.axes.x)}`,
    `  Y ${formatVector(anatomicalFrame.axes.y)}`,
    `  Z ${formatVector(anatomicalFrame.axes.z)}`,
  ].join('\n');
}

function formatSideAngles(label, angles) {
  if (!angles) {
    return `${label} gait n/a`;
  }

  return [
    `${label} hip flex ${formatDeg(angles.hipFlexionDeg)}`,
    `hip angle ${formatDeg(angles.hipIncludedDeg)}`,
    `knee flex ${formatDeg(angles.kneeFlexionDeg)}`,
    `knee angle ${formatDeg(angles.kneeIncludedDeg)}`,
    `ankle ${formatDeg(angles.ankleIncludedDeg)}`,
    `foot pitch ${formatDeg(angles.footPitchDeg)}`,
    `contact ${angles.contact ? 'yes' : 'no'}`,
  ].join('  ');
}

function formatTarget(label, target) {
  if (!target) {
    return `${padLabel(label)} n/a`;
  }

  return [
    `${padLabel(label)} pos ${formatVector(target.position)}`,
    `rot ${formatEulerRadians(target.euler)}`,
    target.contact === null ? '' : `contact ${target.contact ? 'yes' : 'no'}`,
  ].filter(Boolean).join('  ');
}

function formatPole(label, pole) {
  if (!pole) {
    return `${padLabel(label)} n/a`;
  }

  return `${padLabel(label)} pos ${formatVector(pole.position)}  dir ${formatVector(pole.direction)}`;
}

function formatChannels(channels) {
  if (!channels) {
    return 'n/a';
  }

  return Object.entries(channels)
    .map(([channel, value]) => `${channel.replace('rotation', 'rot').replace('position', 'pos')} ${formatNumber(value)}`)
    .join('  ');
}

function formatEulerRadians(euler) {
  if (!euler) {
    return 'n/a';
  }

  return formatEulerDeg({
    x: THREE.MathUtils.radToDeg(euler.x),
    y: THREE.MathUtils.radToDeg(euler.y),
    z: THREE.MathUtils.radToDeg(euler.z),
  });
}

function formatEulerDeg(eulerDeg) {
  if (!eulerDeg) {
    return 'n/a';
  }

  return `X ${formatDeg(eulerDeg.x)}  Y ${formatDeg(eulerDeg.y)}  Z ${formatDeg(eulerDeg.z)}`;
}

function formatVector(vector) {
  if (!vector) {
    return 'n/a';
  }

  return `${vector.x.toFixed(3)}, ${vector.y.toFixed(3)}, ${vector.z.toFixed(3)}`;
}

function formatSeconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)}s` : 'n/a';
}

function formatDeg(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} deg` : 'n/a';
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a';
}

function padLabel(label) {
  return label.padEnd(12, ' ');
}

function exportBvhAnalysis(format) {
  if (!bvhIkRuntime) {
    return;
  }

  const baseName = 'bvh-gait-analysis';

  if (format === 'csv') {
    downloadTextFile(
      `${baseName}.csv`,
      bvhIkRuntime.buildAnalysisCsv(),
      'text/csv;charset=utf-8',
    );
    return;
  }

  downloadTextFile(
    `${baseName}.json`,
    JSON.stringify(bvhIkRuntime.buildAnalysisFrames(), null, 2),
    'application/json;charset=utf-8',
  );
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
