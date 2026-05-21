import { createGymEnvironment } from '../three/gym.js';
import { createBvhIkDebug } from '../three/bvh-ik-debug.js';
import { createThreeScene } from '../three/scene.js';
import * as THREE from 'three';

const FRAME_RATE = 30;
const VIDEO_SEEK_EPSILON = 0.5 / FRAME_RATE;
const VIDEO_END_EPSILON = 0.001;
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

const three = createThreeScene(canvas);
const gym = createGymEnvironment();
const bvhIkDebug = createBvhIkDebug();
const followTargetPosition = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const nextTarget = new THREE.Vector3();
const targetDelta = new THREE.Vector3();
const cameraOffset = new THREE.Vector3(3.4, 1.85, 5.2);
let followTarget = null;
let fpsElapsed = 0;
let fpsFrames = 0;
let latestFps = 0;
let playAttemptId = 0;

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

let bvhIkRuntime = null;
let latestIkReadoutFrame = -1;

three.scene.add(gym.lightRig, gym.gridFloor, bvhIkDebug.root);
three.start(({ delta }) => {
  updateFps(delta);
  updatePlayback(delta);
  updateCameraFollow(delta);
});

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

gym.modelReady
  .then((result) => {
    if (result?.model) {
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

    ikDebugStatus.textContent = `${runtime.metadata.frames}f / ${runtime.metadata.bones} bones`;
    ikExportJson.disabled = false;
    ikExportCsv.disabled = false;
    updateIkDebugUi(runtime.getCurrentFrame(), true);
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

  followTarget.getWorldPosition(followTargetPosition);
  desiredTarget.set(followTargetPosition.x, 1.35, followTargetPosition.z);

  const alpha = 1 - Math.exp(-delta * 5.5);
  nextTarget.copy(three.controls.target).lerp(desiredTarget, alpha);
  targetDelta.subVectors(nextTarget, three.controls.target);
  three.controls.target.copy(nextTarget);
  three.camera.position.add(targetDelta);
}

function setPlaying(isPlaying) {
  timeline.isPlaying = isPlaying;
  updatePlayButton();

  if (!isPlaying) {
    playAttemptId += 1;
    video.pause();
    syncFrameFromVideo();
    seekVideoToFrame(timeline.frame, true);
    return;
  }

  timeline.manualClock = false;
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

  timeline.animationTargets.forEach((target) => {
    const frame = target.setTime?.(time);

    if (target.id === 'bvh-ik' && frame) {
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

function updateIkDebugUi(frame, force = false) {
  if (!frame || (!force && frame.frameIndex === latestIkReadoutFrame)) {
    return;
  }

  latestIkReadoutFrame = frame.frameIndex;
  ikDebugReadout.textContent = formatIkDebugReadout(frame);
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
