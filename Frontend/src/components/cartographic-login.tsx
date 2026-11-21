"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Point = readonly [number, number];

// Coordinates follow the illustrated parcels in the 1024 × 688 WebP.
const parcels: readonly (readonly Point[])[] = [
  [[224,105],[247,100],[254,139],[244,137.5],[231,140.5],[228,131],[226,120]],
  [[784,56.5],[805.75,47],[815,67.25],[791.5,77.5],[787.5,70.75]],
  [[40.75,479.5],[51.5,491.5],[59.5,499.5],[68,508],[59.75,557.75],[34.25,553.25],[37,525.25]],
  [[806.25,46.75],[819.75,39.5],[828,61.25],[815,67.25]],
  [[68,508.5],[80,518],[93,524],[83,565.25],[59,561]],
  [[819.75,39.5],[831.25,34.5],[840,59],[828,61.25]],
  [[93,524],[104,529],[118,533],[108,568],[95,564],[84.75,560.25]],
  [[831.25,34.5],[854.25,24],[884,69.25],[850.75,87],[840,59]],
  [[692.25,463.5],[708,452.5],[722,447.5],[747.25,438.75],[751.25,448.5],[755.25,468.5],[758.75,511.75],[748.25,510.25],[733.5,513.5],[715.75,521.75],[695.75,471.5]],
  [[854.25,24],[883.75,11.25],[903,57.5],[884,69.25]],
  [[535.75,516],[552,509.5],[567.75,506],[586.75,550.75],[611,604.25],[603,607.5],[584.5,609.25],[576,613],[561,576.5]],
  [[497,546.75],[519.5,531],[540.25,583.25],[559,625.5],[543,633],[527,634]],
  [[540.25,583.25],[560,575.75],[576,612],[567,620],[559,625.5]],
  [[791.5,77.5],[815,67.25],[819.5,82.75],[799,90.5],[796.5,84.75]],
];

const highlightDuration = 1450;
const staticMapQuery = "(prefers-reduced-motion: reduce), (forced-colors: active)";

export function CartographicLogin({ children }: { children: ReactNode }) {
  const container = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [canAnimate, setCanAnimate] = useState(false);
  const syncPlayback = useRef<() => void>(null);

  useEffect(() => {
    const map = container.current;
    const layer = canvas.current;
    const card = map?.querySelector(".auth-card");
    const context = layer?.getContext("2d");
    if (!map || !layer || !card || !context) return;

    const motion = matchMedia(staticMapQuery);
    let width = 0;
    let height = 0;
    let frame = 0;
    let elapsed = 0;
    let previousTime: number | null = null;
    let visible: { ring: Point[]; edges: number[]; length: number }[] = [];

    const paint = () => {
      context.clearRect(0, 0, width, height);
      if (visible.length === 0 || motion.matches) return;
      const phase = elapsed % highlightDuration;
      const { ring, edges, length } = visible[Math.floor(elapsed / highlightDuration) % visible.length];
      const progress = Math.min(1, (phase + 85) / 990);
      const opacity = Math.min(1, .16 + phase / 180, (highlightDuration - phase) / 320);
      context.beginPath();
      context.moveTo(...ring[0]);
      let remaining = length * progress;
      for (const [index, distance] of edges.entries()) {
        const [x, y] = ring[index];
        const [nextX, nextY] = ring[index + 1];
        const fraction = Math.min(1, remaining / distance);
        context.lineTo(x + (nextX - x) * fraction, y + (nextY - y) * fraction);
        remaining -= distance;
        if (remaining <= 0) break;
      }
      context.lineJoin = "round";
      context.lineCap = "round";
      context.lineWidth = 1.4;
      context.strokeStyle = `rgba(178, 233, 223, ${opacity * .82})`;
      context.stroke();
    };

    function tick(now: number) {
      if (previousTime !== null) elapsed += now - previousTime;
      previousTime = now;
      paint();
      frame = requestAnimationFrame(tick);
    }

    const synchronize = () => {
      cancelAnimationFrame(frame);
      previousTime = null;
      setCanAnimate(!motion.matches && visible.length > 0);
      if (document.hidden || motion.matches || visible.length === 0) {
        context.clearRect(0, 0, width, height);
        return;
      }
      paint();
      if (!pausedRef.current) frame = requestAnimationFrame(tick);
    };

    const resize = () => {
      width = map.clientWidth;
      height = map.clientHeight;
      if (!width || !height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      layer.width = Math.round(width * ratio);
      layer.height = Math.round(height * ratio);
      context.setTransform(layer.width / width, 0, 0, layer.height / height, 0, 0);
      const scale = Math.max(width / 1024, height / 688);
      const position = parseFloat(getComputedStyle(map).getPropertyValue("--map-position")) / 100;
      const left = (width - 1024 * scale) * position;
      const top = (height - 688 * scale) / 2;
      const mapBounds = map.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      visible = parcels.flatMap(points => {
        const projected = points.map(([x, y]): Point => [left + x * scale, top + y * scale]);
        const exposed = projected.filter(([x, y]) => {
          const viewportX = x + mapBounds.left;
          const viewportY = y + mapBounds.top;
          return x >= 0 && x <= width && y >= 0 && y <= height &&
            (viewportX < cardBounds.left - 5 || viewportX > cardBounds.right + 5 ||
             viewportY < cardBounds.top - 5 || viewportY > cardBounds.bottom + 5);
        });
        if (exposed.length < 2) return [];
        const ring = [...projected, projected[0]];
        const edges = projected.map(([x, y], index) => Math.hypot(ring[index + 1][0] - x, ring[index + 1][1] - y));
        return [{ ring, edges, length: edges.reduce((sum, edge) => sum + edge, 0) }];
      });
      synchronize();
    };

    syncPlayback.current = synchronize;
    const observer = new ResizeObserver(resize);
    observer.observe(map);
    observer.observe(card);
    document.addEventListener("visibilitychange", synchronize);
    motion.addEventListener("change", synchronize);
    resize();

    return () => {
      syncPlayback.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", synchronize);
      motion.removeEventListener("change", synchronize);
    };
  }, []);

  function togglePlayback() {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    syncPlayback.current?.();
  }

  return (
    <main ref={container} className="auth-wrap auth-map">
      <canvas ref={canvas} className="survey-overlay" aria-hidden="true" />
      {children}
      <button className="map-playback" type="button" hidden={!canAnimate} onClick={togglePlayback}>
        {paused ? "Reanudar animación" : "Pausar animación"}
      </button>
    </main>
  );
}
