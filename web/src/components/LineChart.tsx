import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'

export interface Point {
  date: string // YYYY-MM-DD
  value: number | null
}

interface Props {
  points: Point[]
  format: (v: number) => string
  /** Compact tick formatter; defaults to `format`. */
  tickFormat?: (v: number) => string
  height?: number
  label: string
}

// Single-series line chart: 2px line, ~10% area wash, hairline grid, value labeled
// at the line end, crosshair + tooltip on hover. Colors are role tokens (see index.css).
const PAD = { top: 16, right: 64, bottom: 28, left: 52 }

export function LineChart({ points, format, tickFormat = format, height = 220, label }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<number | null>(null)
  const empty = points.length === 0

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [empty])

  const geo = useMemo(() => {
    const defined = points.filter((p): p is { date: string; value: number } => p.value != null)
    const max = Math.max(0, ...defined.map((p) => p.value))
    const ticks = niceTicks(max)
    const top = ticks[ticks.length - 1] ?? 1
    const innerW = Math.max(10, width - PAD.left - PAD.right)
    const innerH = height - PAD.top - PAD.bottom
    const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
    const y = (v: number) => PAD.top + innerH - (top === 0 ? 0 : (v / top) * innerH)
    // break the line at gaps instead of interpolating through missing days
    const segments: string[] = []
    let cur = ''
    points.forEach((p, i) => {
      if (p.value == null) {
        if (cur) segments.push(cur)
        cur = ''
        return
      }
      cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`
    })
    if (cur) segments.push(cur)
    const area = segments.map((d) => {
      const pts = d.slice(1).split('L').map((s) => s.split(',').map(Number) as [number, number])
      const first = pts[0]
      const last = pts[pts.length - 1]
      if (!first || !last) return ''
      return `${d}L${last[0]},${y(0)}L${first[0]},${y(0)}Z`
    })
    let lastIdx = -1
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i]?.value != null) {
        lastIdx = i
        break
      }
    }
    return { ticks, x, y, segments, area, innerW, innerH, lastIdx }
  }, [points, width, height])

  if (points.length === 0) {
    return <p className="text-sm text-neutral-500">No daily data in this window.</p>
  }

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientX - box.left) / box.width
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))))
  }

  const hp = hover != null ? points[hover] : undefined
  const last = geo.lastIdx >= 0 ? points[geo.lastIdx] : undefined
  const labelEvery = Math.max(1, Math.ceil(points.length / 6))

  return (
    <div ref={wrap} className="viz relative w-full">
      <svg width={width} height={height} role="img" aria-label={`${label} by day`} className="block">
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + geo.innerW} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {tickFormat(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.date} x={geo.x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
              {shortDate(p.date)}
            </text>
          ) : null,
        )}
        {geo.area.map((d, i) => (
          <path key={`a${i}`} d={d} fill="var(--series-1)" opacity={0.1} />
        ))}
        {geo.segments.map((d, i) => (
          <path key={`l${i}`} d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {last && last.value != null && hover == null && (
          <g>
            <circle cx={geo.x(geo.lastIdx)} cy={geo.y(last.value)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
            <text x={geo.x(geo.lastIdx) + 8} y={geo.y(last.value)} dy="0.32em" fontSize={12} fontWeight={600} fill="var(--text-primary)">
              {format(last.value)}
            </text>
          </g>
        )}
        {hp && hover != null && (
          <g pointerEvents="none">
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={PAD.top + geo.innerH} stroke="var(--text-muted)" strokeWidth={1} />
            {hp.value != null && (
              <circle cx={geo.x(hover)} cy={geo.y(hp.value)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
            )}
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={geo.innerW}
          height={geo.innerH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hp && hover != null && (
        <div
          className="pointer-events-none absolute top-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            left: Math.min(Math.max(geo.x(hover) - 60, 0), width - 130),
          }}
        >
          <div className="text-neutral-500">{longDate(hp.date)}</div>
          <div className="font-semibold tabular-nums text-neutral-900">
            {label}: {hp.value == null ? '—' : format(hp.value)}
          </div>
        </div>
      )}
    </div>
  )
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [0]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  const out: number[] = []
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

function shortDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

function longDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
