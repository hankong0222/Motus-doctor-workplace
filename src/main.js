import { createGymEnvironment } from '../three/gym.js';
import { createThreeScene } from '../three/scene.js';
import * as THREE from 'three';

const FRAME_STEP = 1 / 30;
const SCRUBBER_MAX = 1000;

const canvas = document.querySelector('#gym-canvas');
const status = document.querySelector('#scene-status');
const video = document.querySelector('#reference-video');
const playToggle = document.querySelector('#play-toggle');
const stepBack = document.querySelector('#step-back');
const stepForward = document.querySelector('#step-forward');
const scrubber = document.querySelector('#timeline-scrubber');
const timelineTime = document.querySelector('#timeline-time');
const speedSelect = document.querySelector('#speed-select');

const three = createThreeScene(canvas);
const gym = createGymEnvironment();
const followTargetPosition = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const nextTarget = new THREE.Vector3();
const targetDelta = new THREE.Vector3();
const cameraOffset = new THREE.Vector3(3.4, 1.85, 5.2);
let followTarget = null;
let fpsElapsed = 0;
let fpsFrames = 0;
let latestFps = 0;

const timeline = {
  animationDuration: 0,
  duration: 0,
  isPlaying: true,
  modelReady: false,
  setAnimationTime: null,
  speed: Number(speedSelect.value),
  time: 0,
  useManualVideoClock: false,
  videoReady: false,
};

scrubber.max = String(SCRUBBER_MAX);
scrubber.disabled = true;
video.muted = true;
video.defaultMuted = true;
video.setAttribute('muted', '');
video.loop = true;
video.playbackRate = timeline.speed;

three.scene.add(gym.lightRig, gym.gridFloor);
three.start(({ delta }) => {
  updateFps(delta);
  updatePlayback(delta);
  updateCameraFollow(delta);
});

video.addEventListener('loadedmetadata', () => {
  timeline.videoReady = true;
  updateDuration();
  setTimelineTime(timeline.time, { forceVideo: true });
  tryPlayVideo();
});

video.addEventListener('seeking', () => {
  syncModelToProgress(getProgress());
});

video.addEventListener('ratechange', () => {
  if (video.playbackRate !== timeline.speed) {
    video.playbackRate = timeline.speed;
  }
});

playToggle.addEventListener('click', () => {
  setPlaying(!timeline.isPlaying);
});

stepBack.addEventListener('click', () => {
  setPlaying(false);
  setTimelineTime(timeline.time - FRAME_STEP, { forceVideo: true, wrap: true });
});

stepForward.addEventListener('click', () => {
  setPlaying(false);
  setTimelineTime(timeline.time + FRAME_STEP, { forceVideo: true, wrap: true });
});

scrubber.addEventListener('input', () => {
  setPlaying(false);

  const duration = updateDuration();
  const progress = Number(scrubber.value) / SCRUBBER_MAX;

  setTimelineTime(progress * duration, { forceVideo: true, wrap: false });
});

speedSelect.addEventListener('change', () => {
  timeline.speed = Number(speedSelect.value);
  video.playbackRate = timeline.speed;
});

gym.modelReady
  .then((result) => {
    if (result?.model) {
      followTarget = result.followTarget ?? gym.modelRoot.userData.followTarget ?? result.model;
      timeline.modelReady = true;
      timeline.animationDuration = result.animation?.duration ?? result.animations?.[0]?.duration ?? 0;
      timeline.setAnimationTime = result.animation?.setTime ?? null;

      followTarget.getWorldPosition(followTargetPosition);
      three.controls.target.set(followTargetPosition.x, 1.35, followTargetPosition.z);
      three.camera.position.copy(three.controls.target).add(cameraOffset);
      three.controls.update();

      updateDuration();
      setTimelineTime(timeline.time, { forceVideo: true });
      tryPlayVideo();
    }

    status.textContent = formatStatus();
  })
  .catch((error) => {
    console.error(error);
    status.textContent = 'Model failed';
  });

function updatePlayback(delta) {
  const duration = updateDuration();

  if (duration <= 0) {
    updateTimelineUi(0);
    return;
  }

  if (timeline.isPlaying) {
    if (timeline.videoReady && !video.paused && !timeline.useManualVideoClock) {
      timeline.time = video.currentTime;
      syncModelToProgress(getProgress());
      updateTimelineUi(getProgress());
    } else {
      setTimelineTime(timeline.time + delta * timeline.speed, {
        forceVideo: timeline.videoReady,
        wrap: true,
      });
    }
  }
}

function updateFps(delta) {
  fpsElapsed += delta;
  fpsFrames += 1;

  if (fpsElapsed >= 0.5) {
    latestFps = Math.round(fpsFrames / fpsElapsed);
    fpsElapsed = 0;
    fpsFrames = 0;

    if (timeline.modelReady) {
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
  playToggle.textContent = isPlaying ? 'Pause' : 'Play';

  if (isPlaying) {
    timeline.useManualVideoClock = false;
    tryPlayVideo();
  } else {
    video.pause();
  }
}

function tryPlayVideo() {
  if (!timeline.isPlaying || !timeline.videoReady || !timeline.modelReady) {
    return;
  }

  video.playbackRate = timeline.speed;
  video.play().catch(() => {
    timeline.useManualVideoClock = true;
    playToggle.textContent = 'Pause';
  });
}

function updateDuration() {
  const videoDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;

  timeline.duration = videoDuration || timeline.animationDuration || 0;
  scrubber.disabled = timeline.duration <= 0;

  return timeline.duration;
}

function setTimelineTime(time, { forceVideo = false, wrap = true } = {}) {
  const duration = updateDuration();

  if (duration <= 0) {
    return;
  }

  timeline.time = wrap ? wrapTime(time, duration) : clamp(time, 0, duration);
  const progress = getProgress();

  syncModelToProgress(progress);
  syncVideoToProgress(progress, forceVideo || !timeline.isPlaying);
  updateTimelineUi(progress);
}

function syncModelToProgress(progress) {
  if (!timeline.setAnimationTime || timeline.animationDuration <= 0) {
    return;
  }

  timeline.setAnimationTime(progress * timeline.animationDuration);
}

function syncVideoToProgress(progress, force) {
  if (!timeline.videoReady || !Number.isFinite(video.duration) || video.duration <= 0) {
    return;
  }

  const targetTime = clamp(progress * video.duration, 0, Math.max(video.duration - 0.001, 0));
  const drift = Math.abs(video.currentTime - targetTime);

  if (force || drift > 0.12) {
    video.currentTime = targetTime;
  }
}

function getProgress() {
  if (timeline.duration <= 0) {
    return 0;
  }

  return clamp(timeline.time / timeline.duration, 0, 1);
}

function updateTimelineUi(progress) {
  scrubber.value = String(Math.round(progress * SCRUBBER_MAX));
  timelineTime.textContent = `${formatTime(timeline.time)} / ${formatTime(timeline.duration)}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00';
  }

  const minutes = Math.floor(seconds / 60);
  const wholeSeconds = Math.floor(seconds % 60);

  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`;
}

function wrapTime(time, duration) {
  return ((time % duration) + duration) % duration;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatStatus() {
  return latestFps > 0 ? `Ready / ${latestFps} fps` : 'Ready';
}
