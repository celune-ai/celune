'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useWorkspace } from '@/providers/workspace-provider';
import { fetchJson } from '@/lib/fetch-json';
import type { MemoryCategory } from '@repo/types';
import { MEMORY_CATEGORIES } from '@repo/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string;
  key: string;
  category: MemoryCategory | string;
  importance_score: number;
  // Runtime simulation state
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  source: string;
  target: string;
  relation_type: string;
  confidence: number;
  is_auto_detected?: boolean;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface MemoryGraphProps {
  seedMemoryId?: string;
  onNodeClick?: (memoryId: string) => void;
  /** Callback to switch to another tab (e.g., back to "memories") */
  onSwitchTab?: (tab: string) => void;
}

// ---------------------------------------------------------------------------
// Category color palette (7 badge colors)
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  preference: '#3b82f6', // blue
  decision: '#22c55e', // green
  context: '#f59e0b', // amber
  fact: '#a855f7', // purple
  general: '#06b6d4', // cyan
  handoff: '#ec4899', // pink
  episode: '#ef4444', // red
  pattern: '#8b5cf6', // violet
};

const DEFAULT_NODE_COLOR = '#6b7280';

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? DEFAULT_NODE_COLOR;
}

// ---------------------------------------------------------------------------
// Force simulation (lightweight, no d3-force dependency)
// ---------------------------------------------------------------------------

const REPULSION = 800;
const ATTRACTION = 0.04;
const DAMPING = 0.85;
const CENTER_GRAVITY = 0.01;

function stepSimulation(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = REPULSION / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  const nodeMap = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    const a = nodeMap.get(edge.source);
    const b = nodeMap.get(edge.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const force = ATTRACTION * dist;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  for (const node of nodes) {
    node.vx += (cx - node.x) * CENTER_GRAVITY;
    node.vy += (cy - node.y) * CENTER_GRAVITY;
    node.vx *= DAMPING;
    node.vy *= DAMPING;
    node.x += node.vx;
    node.y += node.vy;
    node.x = Math.max(20, Math.min(width - 20, node.x));
    node.y = Math.max(20, Math.min(height - 20, node.y));
  }
}

// ---------------------------------------------------------------------------
// Resolve CSS variables at runtime for canvas 2D context
// ---------------------------------------------------------------------------

function resolveColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

// ---------------------------------------------------------------------------
// Hook: reactive prefers-reduced-motion
// ---------------------------------------------------------------------------

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type RelationTypeFilter = {
  manual: boolean;
  auto: boolean;
  contradicts: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MemoryGraph({ seedMemoryId, onNodeClick, onSwitchTab }: MemoryGraphProps) {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const hoveredNodeRef = useRef<GraphNode | null>(null);
  const focusedIndexRef = useRef<number>(-1);
  const simRunningRef = useRef(false);
  const simTicksRef = useRef(0);

  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Graph mode: 'seed' focuses on a single memory's neighborhood, 'full' shows all
  const [graphMode, setGraphMode] = useState<'seed' | 'full'>(seedMemoryId ? 'seed' : 'full');

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [relFilters, setRelFilters] = useState<RelationTypeFilter>({
    manual: true,
    auto: true,
    contradicts: true,
  });
  const [minConfidence, setMinConfidence] = useState(0);
  const [depth, setDepth] = useState(2);

  // Tooltip state
  const tooltipId = 'memory-graph-tooltip';
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);

  const prefersReducedMotion = usePrefersReducedMotion();

  // -------------------------------------------------------------------------
  // Fetch
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);

    // Seed mode: BFS from one memory. Full mode: all workspace memories.
    const mode = !seedMemoryId ? 'full' : graphMode;
    const url =
      mode === 'seed' && seedMemoryId
        ? `/api/memory/graph?seed=${seedMemoryId}&depth=${depth}&workspace_id=${workspaceId}`
        : `/api/memory/graph?workspace_id=${workspaceId}`;

    fetchJson<GraphData>(url)
      .then((d) => {
        const canvas = canvasRef.current;
        const w = canvas?.width ?? 600;
        const h = canvas?.height ?? 400;
        const cx = w / 2;
        const cy = h / 2;

        const nodes: GraphNode[] = d.nodes.map((n, i) => ({
          ...n,
          x: cx + Math.cos((i / d.nodes.length) * Math.PI * 2) * 150,
          y: cy + Math.sin((i / d.nodes.length) * Math.PI * 2) * 150,
          vx: 0,
          vy: 0,
        }));

        nodesRef.current = nodes;
        edgesRef.current = d.edges;
        simRunningRef.current = true;
        simTicksRef.current = 0;
        focusedIndexRef.current = -1;
        setData({ nodes, edges: d.edges });
      })
      .catch(() => setError('Failed to load graph'))
      .finally(() => setLoading(false));
  }, [workspaceId, seedMemoryId, depth, graphMode]);

  // -------------------------------------------------------------------------
  // Derived: filtered edges
  // -------------------------------------------------------------------------

  const filteredEdges = (edgesRef.current ?? []).filter((e) => {
    if (e.confidence < minConfidence) return false;
    if (e.relation_type === 'contradicts' && !relFilters.contradicts) return false;
    if (e.is_auto_detected && !relFilters.auto) return false;
    if (!e.is_auto_detected && !relFilters.manual) return false;
    return true;
  });

  const filteredNodes = (nodesRef.current ?? []).filter((n) => {
    if (categoryFilter !== 'all' && n.category !== categoryFilter) return false;
    return true;
  });

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const visibleEdges = filteredEdges.filter(
    (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
  );

  // -------------------------------------------------------------------------
  // Canvas render
  // -------------------------------------------------------------------------

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Resolve CSS vars for canvas context
    const bgColor = resolveColor('--background', '#0f0f0f');
    const fgColor = resolveColor('--foreground', '#e5e5e5');
    const fgMuted = resolveColor('--foreground-muted', 'rgba(255,255,255,0.18)');

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    // Edges
    for (const edge of visibleEdges) {
      const src = filteredNodes.find((n) => n.id === edge.source);
      const tgt = filteredNodes.find((n) => n.id === edge.target);
      if (!src || !tgt) continue;

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);

      const isContradicts = edge.relation_type === 'contradicts';
      ctx.strokeStyle = isContradicts ? '#ef4444' : fgMuted;
      ctx.lineWidth = isContradicts ? 2 : 1;

      if (edge.is_auto_detected) {
        ctx.setLineDash([4, 4]);
      } else {
        ctx.setLineDash([]);
      }

      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Nodes
    const focusedNode =
      focusedIndexRef.current >= 0 ? filteredNodes[focusedIndexRef.current] : null;

    for (const node of filteredNodes) {
      const radius = Math.max(6, Math.min(20, 6 + node.importance_score * 10));
      const color = getCategoryColor(node.category);
      const isHovered = hoveredNodeRef.current?.id === node.id;
      const isFocused = focusedNode?.id === node.id;

      // Glow for hovered or focused
      if (isHovered || isFocused) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = color + '33';
        ctx.fill();

        // Focus ring
        if (isFocused) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
          ctx.strokeStyle = fgColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Ring for seed node
      if (seedMemoryId && node.id === seedMemoryId) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = fgColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      if (filteredNodes.length <= 40 || isHovered || isFocused) {
        const label =
          node.key?.length > 20 ? node.key.slice(0, 18) + '…' : (node.key ?? node.id.slice(0, 8));
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = fgColor + 'd9'; // ~85% opacity
        ctx.textAlign = 'center';
        ctx.fillText(label, node.x, node.y + radius + 13);
      }
    }
  }, [filteredNodes, visibleEdges, seedMemoryId]);

  // -------------------------------------------------------------------------
  // Animation loop
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!data) return;

    const MAX_TICKS = 300;

    function loop() {
      if (simRunningRef.current && simTicksRef.current < MAX_TICKS && !prefersReducedMotion) {
        const canvas = canvasRef.current;
        stepSimulation(
          nodesRef.current,
          edgesRef.current,
          canvas?.width ?? 600,
          canvas?.height ?? 400,
        );
        simTicksRef.current++;
        if (simTicksRef.current >= MAX_TICKS) simRunningRef.current = false;
      }
      render();
      animFrameRef.current = requestAnimationFrame(loop);
    }

    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [data, render, prefersReducedMotion]);

  // -------------------------------------------------------------------------
  // Canvas resize observer
  // -------------------------------------------------------------------------

  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width = Math.floor(width);
        canvas.height = Math.floor(height);
      }
    });
    ro.observe(el);

    const rect = el.getBoundingClientRect();
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);

    return () => ro.disconnect();
  }, []);

  // -------------------------------------------------------------------------
  // Mouse events
  // -------------------------------------------------------------------------

  const getNodeAtPoint = useCallback(
    (x: number, y: number): GraphNode | null => {
      for (const node of filteredNodes) {
        const radius = Math.max(6, Math.min(20, 6 + node.importance_score * 10));
        const dx = node.x - x;
        const dy = node.y - y;
        if (dx * dx + dy * dy <= (radius + 4) * (radius + 4)) return node;
      }
      return null;
    },
    [filteredNodes],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const node = getNodeAtPoint(x, y);
      hoveredNodeRef.current = node;
      if (node) {
        setTooltip({ x: e.clientX, y: e.clientY, node });
        if (canvasRef.current) canvasRef.current.style.cursor = 'pointer';
      } else {
        setTooltip(null);
        if (canvasRef.current) canvasRef.current.style.cursor = 'default';
      }
    },
    [getNodeAtPoint],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const node = getNodeAtPoint(x, y);
      if (node) onNodeClick?.(node.id);
    },
    [getNodeAtPoint, onNodeClick],
  );

  const handleMouseLeave = useCallback(() => {
    hoveredNodeRef.current = null;
    setTooltip(null);
  }, []);

  // -------------------------------------------------------------------------
  // Keyboard navigation
  // -------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (filteredNodes.length === 0) return;

      if (e.key === 'Tab') {
        // Let Tab move to next/prev node in the graph
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        const next = focusedIndexRef.current + dir;
        if (next >= 0 && next < filteredNodes.length) {
          focusedIndexRef.current = next;
          const node = filteredNodes[next];
          setTooltip({ x: node.x, y: node.y, node });
        } else if (next < 0) {
          focusedIndexRef.current = filteredNodes.length - 1;
          const node = filteredNodes[filteredNodes.length - 1];
          setTooltip({ x: node.x, y: node.y, node });
        } else {
          focusedIndexRef.current = 0;
          const node = filteredNodes[0];
          setTooltip({ x: node.x, y: node.y, node });
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const idx = focusedIndexRef.current;
        if (idx >= 0 && idx < filteredNodes.length) {
          onNodeClick?.(filteredNodes[idx].id);
        }
      } else if (e.key === 'Escape') {
        focusedIndexRef.current = -1;
        setTooltip(null);
      }
    },
    [filteredNodes, onNodeClick],
  );

  const handleFocus = useCallback(() => {
    if (focusedIndexRef.current < 0 && filteredNodes.length > 0) {
      focusedIndexRef.current = 0;
      const node = filteredNodes[0];
      setTooltip({ x: node.x, y: node.y, node });
    }
  }, [filteredNodes]);

  const handleBlur = useCallback(() => {
    focusedIndexRef.current = -1;
    setTooltip(null);
  }, []);

  // -------------------------------------------------------------------------
  // Empty / loading states
  // -------------------------------------------------------------------------

  // Effective mode: if no seed is available, always use full graph
  const effectiveMode = !seedMemoryId ? 'full' : graphMode;

  if (loading) {
    return (
      <div className="border-border bg-surface-100 flex h-64 items-center justify-center rounded-xl border">
        <p className="text-foreground-lighter text-sm">Loading graph...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-border bg-surface-100 flex h-64 items-center justify-center rounded-xl border">
        <p className="text-destructive text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Description */}
      <div>
        <p className="text-foreground-lighter text-sm">
          Visualize how your memories connect to each other. Nodes represent individual memories and
          edges show relationships between them. Click any node to view its details.
        </p>
      </div>

      {/* Filter controls */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        {/* Graph mode toggle */}
        {seedMemoryId && (
          <div className="border-border bg-surface-200 inline-flex rounded-md border text-xs">
            <button
              type="button"
              onClick={() => setGraphMode('seed')}
              className={`rounded-l-md px-2.5 py-1 transition-colors ${graphMode === 'seed' ? 'bg-brand text-black' : 'text-foreground-lighter hover:text-foreground'}`}
            >
              Focused
            </button>
            <button
              type="button"
              onClick={() => setGraphMode('full')}
              className={`rounded-r-md px-2.5 py-1 transition-colors ${graphMode === 'full' ? 'bg-brand text-black' : 'text-foreground-lighter hover:text-foreground'}`}
            >
              Full Graph
            </button>
          </div>
        )}

        {/* Category filter */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
          className="border-border bg-surface-100 text-foreground-light min-w-0 appearance-none rounded-md border py-1.5 pr-7 pl-3 text-xs"
        >
          <option value="all">All categories</option>
          {MEMORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {/* Relation type checkboxes */}
        <fieldset className="flex min-w-0 items-center gap-3">
          <legend className="sr-only">Relation types</legend>
          {(
            [
              ['manual', 'Manual'],
              ['auto', 'Auto-detected'],
              ['contradicts', 'Contradicts'],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="text-foreground-lighter flex cursor-pointer items-center gap-1.5 text-xs"
            >
              <input
                type="checkbox"
                checked={relFilters[key]}
                onChange={(e) => setRelFilters((prev) => ({ ...prev, [key]: e.target.checked }))}
                className="accent-brand rounded"
              />
              {label}
            </label>
          ))}
        </fieldset>

        {/* Confidence slider */}
        <label className="text-foreground-lighter flex items-center gap-2 text-xs">
          <span>Min confidence: {Math.round(minConfidence * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
            aria-label="Minimum confidence"
            className="accent-brand w-24"
          />
        </label>

        {/* Depth slider */}
        <label className="text-foreground-lighter flex items-center gap-2 text-xs">
          <span>Depth: {depth}</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            aria-label="Graph traversal depth"
            className="accent-brand w-20"
          />
        </label>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="border-border bg-background relative w-full overflow-hidden rounded-xl border"
        style={{ height: Math.max(240, Math.min(420, filteredNodes.length * 40 + 120)) }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={`Memory knowledge graph${data ? ` with ${filteredNodes.length} nodes and ${visibleEdges.length} connections. Use Tab to navigate nodes, Enter to select.` : ''}`}
          aria-describedby={tooltip ? tooltipId : undefined}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          onMouseLeave={handleMouseLeave}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="focus-visible:ring-brand focus-visible:ring-offset-background absolute inset-0 h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        />

        {/* Legend */}
        <div className="bg-background/80 absolute right-3 bottom-3 flex flex-col gap-1 rounded-lg px-2.5 py-2 backdrop-blur-sm">
          {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-foreground-lighter text-[10px] capitalize">{cat}</span>
            </div>
          ))}
        </div>

        {/* Stats */}
        {data && (
          <div className="bg-background/80 absolute top-3 left-3 rounded-lg px-2.5 py-1.5 backdrop-blur-sm">
            <p className="text-foreground-lighter text-[10px]">
              {filteredNodes.length} nodes · {visibleEdges.length} edges
            </p>
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          id={tooltipId}
          role="tooltip"
          className="border-border bg-surface-300 pointer-events-none fixed z-50 rounded-lg border px-3 py-2 text-xs shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <p className="text-foreground font-medium">
            {tooltip.node.key || tooltip.node.id.slice(0, 12)}
          </p>
          <p className="text-foreground-lighter capitalize">{tooltip.node.category}</p>
          <p className="text-foreground-muted">
            Importance: {tooltip.node.importance_score.toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}
