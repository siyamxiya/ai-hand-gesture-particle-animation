"use client";

import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";

type Stage = "dormant" | "forming" | "final";

type ArtPoint = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
};

type Particle = ArtPoint & {
  vx: number;
  vy: number;
  homeX: number;
  homeY: number;
  seed: number;
  size: number;
  alpha: number;
};

type Point = { x: number; y: number };

const TAU = Math.PI * 2;

function makeFinalArtwork(width: number, height: number, desired: number): ArtPoint[] {
  const source = document.createElement("canvas");
  source.width = 1200;
  source.height = 900;
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return [];

  context.textBaseline = "middle";
  context.font = "800 178px Arial, sans-serif";
  const iWidth = context.measureText("I").width;
  const chinaWidth = context.measureText("CHINA").width;
  context.font = "800 168px Arial, sans-serif";
  const heartWidth = context.measureText("♥").width;
  const gap = 48;
  const lineWidth = iWidth + heartWidth + chinaWidth + gap * 2;
  let cursor = (source.width - lineWidth) / 2;
  context.textAlign = "left";
  context.font = "800 178px Arial, sans-serif";
  context.fillStyle = "rgb(224, 244, 255)";
  context.fillText("I", cursor, 190);
  cursor += iWidth + gap;
  context.font = "800 168px Arial, sans-serif";
  context.fillStyle = "rgb(239, 42, 69)";
  context.fillText("♥", cursor, 188);
  cursor += heartWidth + gap;
  context.font = "800 178px Arial, sans-serif";
  context.fillStyle = "rgb(224, 244, 255)";
  context.fillText("CHINA", cursor, 190);

  context.textAlign = "center";
  context.font = "700 126px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillStyle = "rgb(255, 218, 78)";
  context.fillText("我 爱 中 国", source.width / 2, 445);

  context.font = "700 106px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillStyle = "rgb(255, 242, 205)";
  context.fillText("大 工", source.width / 2, 646);

  context.font = "600 62px Arial, sans-serif";
  context.fillStyle = "rgb(255, 202, 58)";
  context.fillText("2 0 2 6", source.width / 2, 795);

  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  const raw: ArtPoint[] = [];
  for (let y = 0; y < source.height; y += 5) {
    for (let x = 0; x < source.width; x += 5) {
      const index = (y * source.width + x) * 4;
      if (pixels[index + 3] < 90) continue;
      raw.push({
        x,
        y,
        r: pixels[index],
        g: pixels[index + 1],
        b: pixels[index + 2],
      });
    }
  }

  const scale = Math.min(
    width * (width < 720 ? 0.9 : 0.62) / source.width,
    height * (width < 720 ? 0.76 : 0.82) / source.height,
  );
  const fitted = raw.map((point) => ({
    ...point,
    x: width / 2 + (point.x - source.width / 2) * scale,
    y: height / 2 + (point.y - source.height / 2) * scale,
  }));
  if (fitted.length <= desired) return fitted;

  const sampled: ArtPoint[] = [];
  const stride = fitted.length / desired;
  for (let index = 0; index < desired; index += 1) {
    sampled.push(fitted[Math.floor(index * stride)]);
  }
  return sampled;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ParticleWorld({
  videoRef,
  cameraActive,
  onStageChange,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraActive: boolean;
  onStageChange: (stage: Stage) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 1;
    let height = 1;
    let ratio = 1;
    let animationFrame = 0;
    let stage: Stage = "dormant";
    let stageChangedAt = performance.now();
    let particles: Particle[] = [];
    let finalTargets: ArtPoint[] = [];
    let recognizer: GestureRecognizer | null = null;
    let recognizerPromise: Promise<void> | null = null;
    let cancelled = false;
    let lastRecognitionAt = 0;
    let lastVideoTime = -1;
    let victoryStreak = 0;
    let pinchStreak = 0;
    let burst = 0;
    const hand = { x: 0, y: 0, targetX: 0, targetY: 0, energy: 0, seen: false };
    const pointer = { x: 0, y: 0, energy: 0 };

    const changeStage = (next: Stage, now: number) => {
      if (stage === next) return;
      stage = next;
      stageChangedAt = now;
      burst = 1;
      particles.forEach((particle) => {
        const angle = Math.atan2(particle.y - height / 2, particle.x - width / 2);
        const force = next === "final" ? 5 + Math.random() * 9 : 2 + Math.random() * 5;
        particle.vx += Math.cos(angle) * force;
        particle.vy += Math.sin(angle) * force;
      });
      onStageChange(next);
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const count = width < 720 ? 1200 : Math.min(2500, Math.floor(width * height / 420));
      finalTargets = makeFinalArtwork(width, height, count);
      particles = Array.from({ length: count }, (_, index) => {
        const edge = Math.random();
        const homeX = Math.random() * width;
        const homeY = Math.random() * height;
        const cool = edge > 0.12;
        return {
          x: homeX,
          y: homeY,
          homeX,
          homeY,
          vx: 0,
          vy: 0,
          r: cool ? 111 : 255,
          g: cool ? 201 : 214,
          b: cool ? 255 : 102,
          size: 0.55 + Math.random() * 1.55,
          alpha: 0.15 + Math.random() * 0.5,
          seed: index * 0.6180339 + Math.random() * 7,
        };
      });
      hand.x = hand.targetX = width / 2;
      hand.y = hand.targetY = height / 2;
    };

    const loadRecognizer = () => {
      if (!cameraActive || recognizer || recognizerPromise) return;
      recognizerPromise = (async () => {
        const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const next = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/mediapipe/gesture_recognizer.task" },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.5,
          cannedGesturesClassifierOptions: { scoreThreshold: 0.5 },
        });
        if (cancelled) next.close();
        else recognizer = next;
      })().catch(() => {
        recognizerPromise = null;
      });
    };

    const readGesture = (now: number) => {
      if (!cameraActive) return;
      loadRecognizer();
      const video = videoRef.current;
      if (
        !recognizer ||
        !video ||
        video.readyState < 2 ||
        now - lastRecognitionAt < 85 ||
        video.currentTime === lastVideoTime
      ) return;

      lastRecognitionAt = now;
      lastVideoTime = video.currentTime;
      try {
        const result = recognizer.recognizeForVideo(video, now);
        const category = result.gestures[0]?.[0];
        const landmarks = result.landmarks[0];
        const victory = category?.categoryName === "Victory" && category.score > 0.52;
        victoryStreak = victory ? victoryStreak + 1 : 0;

        if (landmarks?.length >= 10) {
          const indexTip = landmarks[8];
          const thumbTip = landmarks[4];
          const palmScale = distance(landmarks[0], landmarks[9]);
          const pinchRatio = distance(indexTip, thumbTip) / Math.max(palmScale, 0.001);
          const pinching = pinchRatio < 0.42;
          pinchStreak = pinching ? pinchStreak + 1 : 0;
          hand.targetX = (1 - (indexTip.x + thumbTip.x) / 2) * width;
          hand.targetY = ((indexTip.y + thumbTip.y) / 2) * height;
          hand.energy = Math.min(1, hand.energy + 0.24);
          hand.seen = true;
        } else {
          pinchStreak = 0;
          hand.seen = false;
        }

        if (
          victoryStreak >= 2 &&
          stage !== "forming" &&
          now - stageChangedAt > 1100
        ) {
          changeStage("forming", now);
          pinchStreak = 0;
        }
        if (
          stage === "forming" &&
          pinchStreak >= 2 &&
          now - stageChangedAt > 650
        ) {
          changeStage("final", now);
          victoryStreak = 0;
        }
      } catch {
        victoryStreak = 0;
        pinchStreak = 0;
      }
    };

    const movePointer = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.energy = 1;
    };

    const render = (now: number) => {
      readGesture(now);
      const seconds = now / 1000;
      hand.x += (hand.targetX - hand.x) * 0.12;
      hand.y += (hand.targetY - hand.y) * 0.12;
      hand.energy *= 0.965;
      pointer.energy *= 0.95;
      burst *= 0.965;

      context.fillStyle = stage === "final" ? "rgba(3, 4, 9, .2)" : "rgba(2, 6, 13, .23)";
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";

      const focusX = hand.seen ? hand.x : width * 0.52;
      const focusY = hand.seen ? hand.y : height * 0.5;
      const age = Math.min(1, (now - stageChangedAt) / 1900);

      particles.forEach((particle, index) => {
        let targetX = particle.homeX + Math.sin(seconds * 0.24 + particle.seed) * 9;
        let targetY = particle.homeY + Math.cos(seconds * 0.19 + particle.seed * 1.7) * 8;
        let targetR = 104;
        let targetG = 196;
        let targetB = 255;
        let spring = 0.004;

        if (stage === "forming") {
          const lane = index % 7;
          const progress = index / particles.length;
          const angle = progress * TAU * 13 + seconds * (0.52 + lane * 0.026) + particle.seed * 0.18;
          const maxRadius = Math.min(width * 0.38, height * 0.48);
          const radius = (0.12 + (lane / 7) * 0.88) * maxRadius * (0.45 + age * 0.55);
          const wave = Math.sin(angle * 0.72 + seconds * 1.5) * height * 0.05;
          targetX = focusX + Math.cos(angle) * radius;
          targetY = focusY + Math.sin(angle) * radius * 0.2 + wave;
          if (index % 11 === 0) {
            targetX = focusX + Math.sin(particle.seed + seconds) * 28;
            targetY = height * progress + Math.sin(seconds * 1.7 + particle.seed) * 34;
          }
          targetR = index % 17 === 0 ? 255 : 80;
          targetG = index % 17 === 0 ? 219 : 190;
          targetB = index % 17 === 0 ? 101 : 255;
          spring = 0.018 + age * 0.012;
        } else if (stage === "final" && finalTargets.length) {
          const target = finalTargets[index % finalTargets.length];
          targetX = target.x;
          targetY = target.y;
          targetR = target.r;
          targetG = target.g;
          targetB = target.b;
          spring = 0.025 + age * 0.035;
        }

        const activeX = hand.energy > pointer.energy ? hand.x : pointer.x;
        const activeY = hand.energy > pointer.energy ? hand.y : pointer.y;
        const activeEnergy = Math.max(hand.energy, pointer.energy);
        if (activeEnergy > 0.03) {
          const dx = particle.x - activeX;
          const dy = particle.y - activeY;
          const d = Math.hypot(dx, dy);
          if (d < 180 && d > 1) {
            const force = (1 - d / 180) * activeEnergy * (stage === "forming" ? 1.4 : 0.75);
            particle.vx += dx / d * force;
            particle.vy += dy / d * force;
          }
        }

        particle.vx += (targetX - particle.x) * spring;
        particle.vy += (targetY - particle.y) * spring;
        particle.vx *= 0.89;
        particle.vy *= 0.89;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.r += (targetR - particle.r) * 0.07;
        particle.g += (targetG - particle.g) * 0.07;
        particle.b += (targetB - particle.b) * 0.07;

        const twinkle = 0.62 + Math.sin(seconds * 2.2 + particle.seed) * 0.3;
        const alpha = Math.max(0.08, particle.alpha * twinkle + burst * 0.2);
        const size = particle.size * (stage === "final" ? 1.12 : 1) + burst * 0.7;
        context.fillStyle = `rgba(${particle.r | 0},${particle.g | 0},${particle.b | 0},${alpha})`;
        context.beginPath();
        context.arc(particle.x, particle.y, size, 0, TAU);
        context.fill();
      });

      if (stage === "forming") {
        const pulse = 42 + Math.sin(seconds * 3) * 12;
        const glow = context.createRadialGradient(focusX, focusY, 0, focusX, focusY, pulse * 4);
        glow.addColorStop(0, "rgba(152, 225, 255, .22)");
        glow.addColorStop(0.24, "rgba(53, 170, 255, .12)");
        glow.addColorStop(1, "rgba(0, 70, 150, 0)");
        context.fillStyle = glow;
        context.beginPath();
        context.arc(focusX, focusY, pulse * 4, 0, TAU);
        context.fill();
      }

      context.globalCompositeOperation = "source-over";
      animationFrame = requestAnimationFrame(render);
    };

    resize();
    onStageChange("dormant");
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", movePointer);
    window.addEventListener("pointerdown", movePointer);
    animationFrame = requestAnimationFrame(render);

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", movePointer);
      window.removeEventListener("pointerdown", movePointer);
      recognizer?.close();
    };
  }, [cameraActive, onStageChange, videoRef]);

  return <canvas ref={canvasRef} className="particle-world" aria-hidden="true" />;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [stage, setStage] = useState<Stage>("dormant");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const toggleCamera = async () => {
    if (cameraActive) {
      stopCamera();
      return;
    }
    setCameraStarting(true);
    setCameraBlocked(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setCameraBlocked(true);
      setCameraActive(false);
    } finally {
      setCameraStarting(false);
    }
  };

  return (
    <main className={`gesture-stage stage-${stage}`}>
      <ParticleWorld
        videoRef={videoRef}
        cameraActive={cameraActive}
        onStageChange={setStage}
      />
      <div className="star-haze" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      <div className={`camera-orb ${cameraActive ? "is-active" : ""}`} aria-hidden="true">
        <video ref={videoRef} muted playsInline />
        <i />
      </div>

      <div className="stage-meter" data-stage={stage} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <button
        type="button"
        className={`camera-button ${cameraActive ? "is-active" : ""} ${cameraBlocked ? "is-blocked" : ""}`}
        onClick={toggleCamera}
        disabled={cameraStarting}
        aria-label={cameraActive ? "关闭摄像头" : "开启摄像头"}
      >
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M10.2 9.5 12 6.8h8l1.8 2.7h3.4A2.8 2.8 0 0 1 28 12.3v10.9a2.8 2.8 0 0 1-2.8 2.8H6.8A2.8 2.8 0 0 1 4 23.2V12.3a2.8 2.8 0 0 1 2.8-2.8h3.4Z" />
          <circle cx="16" cy="17.3" r="5.1" />
        </svg>
      </button>
    </main>
  );
}
