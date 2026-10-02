'use client';

import { useEffect, useRef } from 'react';

/**
 * Animated dithered organic background using Canvas 2D.
 * Smooth flowing noise field with a static halftone dot grid.
 * The noise evolves continuously — the dither grid never jumps.
 */
export function DitherBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;

    function resize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx!.scale(dpr, dpr);
    }

    resize();
    window.addEventListener('resize', resize);

    // Deterministic hash noise — position-based only, no time dependency
    function hash(x: number, y: number): number {
      let h = x * 374761393 + y * 668265263;
      h = (h ^ (h >> 13)) * 1274126177;
      h = h ^ (h >> 16);
      return (h & 0x7fffffff) / 0x7fffffff;
    }

    // Smooth noise with cubic interpolation
    function smoothNoise(x: number, y: number): number {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;

      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);

      const n00 = hash(ix, iy);
      const n10 = hash(ix + 1, iy);
      const n01 = hash(ix, iy + 1);
      const n11 = hash(ix + 1, iy + 1);

      const nx0 = n00 + (n10 - n00) * sx;
      const nx1 = n01 + (n11 - n01) * sx;

      return nx0 + (nx1 - nx0) * sy;
    }

    // Fractal brownian motion
    function fbm(x: number, y: number, octaves: number): number {
      let value = 0;
      let amplitude = 0.5;
      let frequency = 1;

      for (let i = 0; i < octaves; i++) {
        value += amplitude * smoothNoise(x * frequency, y * frequency);
        amplitude *= 0.5;
        frequency *= 2;
      }

      return value;
    }

    // Pre-compute static dither thresholds per grid cell (never changes)
    let ditherGrid: Float32Array | null = null;
    let gridCols = 0;
    let gridRows = 0;

    const SCALE = 4;

    function ensureDitherGrid(cols: number, rows: number) {
      if (ditherGrid && gridCols === cols && gridRows === rows) return;
      gridCols = cols;
      gridRows = rows;
      ditherGrid = new Float32Array(cols * rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ditherGrid[r * cols + c] = hash(c * 7, r * 13) * 0.12;
        }
      }
    }

    function render(time: number) {
      if (!ctx) return;
      // Very slow time evolution for smooth flow
      const t = time * 0.00015;

      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, width, height);

      const cols = Math.ceil(width / SCALE);
      const rows = Math.ceil(height / SCALE);

      ensureDitherGrid(cols, rows);
      if (!ditherGrid) return;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col / cols;
          const y = row / rows;

          // Smooth layered noise — only time offsets change (continuous)
          const n1 = fbm(x * 3 + t * 0.3, y * 3 + t * 0.15, 4);
          const n2 = fbm(x * 5 - t * 0.2 + 100, y * 5 + t * 0.1 + 100, 3);
          const n3 = fbm(x * 2 + n1 * 0.4, y * 2 + n2 * 0.4 + t * 0.08, 3);

          let value = n1 * 0.4 + n2 * 0.3 + n3 * 0.3;

          // Radial vignette — suppress center, boost edges
          const cx = 0.5;
          const cy = 0.5;
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
          // centerFade: 1 at edges/corners, 0 at dead center
          const centerFade = Math.min(1, dist * 2.5);
          const fade = centerFade * centerFade * (3 - 2 * centerFade);
          // Subtract from value in the center (rather than multiply, which can invert)
          value = value - (1 - fade) * 0.45;

          // Static dither threshold — never changes per pixel
          const threshold = 0.32 + ditherGrid[row * cols + col];

          if (value > threshold) {
            const intensity = Math.min(1, (value - threshold) / 0.45);
            const dotSize = SCALE * 0.3 + SCALE * 0.5 * intensity;
            const brightness = Math.floor(70 + 170 * intensity);

            const px = col * SCALE + SCALE / 2;
            const py = row * SCALE + SCALE / 2;

            ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
            ctx.beginPath();
            ctx.arc(px, py, dotSize / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      animRef.current = requestAnimationFrame(render);
    }

    animRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}
