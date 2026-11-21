"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Point = readonly [number, number];

// Coordinates follow the illustrated parcels in the 1024 × 688 WebP.
const parcels: readonly (readonly Point[])[] = [
  [[17,265],[42,270],[33,297],[26,311],[7,313]],
  [[780,55],[804,47],[815,69],[792,77]],
  [[38,481],[50,493],[58,498],[53,531],[36,527]],
  [[752,17],[796,0],[806,22],[770,37]],
  [[67,518],[100,535],[88,561],[57,553]],
  [[814,43],[840,30],[852,54],[826,65]],
  [[111,539],[137,542],[174,535],[162,562],[102,559]],
  [[790,130],[824,106],[849,147],[815,166]],
  [[259,111],[246,135],[228,140],[224,105],[247,100]],
  [[698,463],[708,453],[722,448],[746,440],[759,511],[732,513],[711,522]],
  [[312,61],[341,43],[342,1],[305,15]],
  [[755,444],[783,462],[792,505],[756,515]],
  [[177,660],[200,642],[215,672],[187,688]],
  [[539,511],[592,587],[577,609],[523,594],[496,546]],
  [[276,580],[303,629],[280,655],[253,603]],
  [[603,494],[624,485],[654,546],[631,558]],
  [[635,480],[653,475],[677,533],[657,547]],
  [[784,397],[811,377],[852,426],[859,453],[836,474],[809,452]],
  [[551,391],[568,383],[573,398],[553,411]],
  [[576,379],[595,371],[602,388],[583,399]],
  [[893,325],[924,307],[952,353],[921,372]],
  [[614,364],[636,354],[645,370],[625,380]],
  [[489,604],[513,592],[527,619],[500,632]],
  [[550,613],[578,608],[595,633],[563,645]],
  [[623,605],[648,591],[665,618],[638,635]],
  [[658,582],[689,563],[706,586],[679,606]],
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
