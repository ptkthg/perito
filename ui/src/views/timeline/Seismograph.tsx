// Sismógrafo: uma linha por fonte, barras na cor da fonte, régua UTC no topo,
// hachura "SEM DADOS" fora da cobertura, marcas ✕ (log limpo) e ▲ (volume alto),
// régua inferior com cursor ▲ do evento selecionado, faixa visível da tabela e janela.
// Arrastar define a janela (de/ate); clique simples vai ao horário.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Modo } from '../../lib/mode';
import type { Histograma } from '../../lib/types';
import { hhmm, isoMs, sourceCode, sourceColor, tsMs } from '../../lib/format';
import { useCharWidth, useElementSize } from '../../lib/hooks';

interface Props {
  hist: Histograma | null;
  sources: string[];
  windowDe: string | null;
  windowAte: string | null;
  cursorTs: string | null;
  visible: [string, string] | null;
  /** horários dos eventos marcados pelo analista (já filtrados) */
  analystMarks: string[];
  markSourceOf(rawRef: string): string | null;
  onWindow(de: string, ate: string): void;
  onPoint(ts: string): void;
  modo: Modo;
  /** primeiro e último evento com técnica (período de atividade suspeita) */
  suspect: [string, string] | null;
}

const ZOOM_PAD_MS = 10 * 60_000;

const TICK_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];

interface Axis {
  t0: number;
  span: number;
  /** baldes visíveis [i0, i1) — zoom é só de visualização, não filtra */
  i0: number;
  i1: number;
  pct(ms: number): number;
  inView(ms: number): boolean;
}

function makeAxis(h: Histograma, zoom: [string, string] | null): Axis {
  const base = tsMs(h.inicio);
  const bms = h.bucket_s * 1000;
  let i0 = 0;
  let i1 = h.n_baldes;
  if (zoom) {
    i0 = Math.max(0, Math.floor((tsMs(zoom[0]) - ZOOM_PAD_MS - base) / bms));
    i1 = Math.min(h.n_baldes, Math.ceil((tsMs(zoom[1]) + ZOOM_PAD_MS - base) / bms));
    if (i1 - i0 < 2) {
      i0 = 0;
      i1 = h.n_baldes;
    }
  }
  const t0 = base + i0 * bms;
  const span = Math.max(1, (i1 - i0) * bms);
  return {
    t0,
    span,
    i0,
    i1,
    pct: (ms) => Math.min(100, Math.max(0, ((ms - t0) / span) * 100)),
    inView: (ms) => ms >= t0 && ms <= t0 + span,
  };
}

/** Barras quantizadas em 8 níveis (como ▁▂▃▄▅▆▇█), escala raiz sobre o máximo global. */
function barsPath(counts: number[], max: number): string {
  if (max <= 0) return '';
  let d = '';
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i]!;
    if (c <= 0) continue;
    const l = Math.max(1, Math.ceil(8 * Math.sqrt(c / max)));
    d += `M${i} ${8 - l}h1v${l}h-1z`;
  }
  return d;
}

const SourceRow = memo(function SourceRow(props: {
  source: string;
  counts: number[] | undefined;
  n: number;
  max: number;
  axis: Axis;
  cov: { primeiro: string; ultimo: string } | undefined;
  hEnd: number;
  marks: { left: number; tipo: string; raw: string; ts: string }[];
  trackW: number;
  chPx: number;
}) {
  const { source, counts, max, axis, cov, hEnd, marks, trackW, chPx } = props;
  const d = useMemo(() => (counts ? barsPath(counts, max) : ''), [counts, max]);
  const total = useMemo(() => (counts ? counts.reduce((a, b) => a + b, 0) : 0), [counts]);
  const gaps: { left: number; width: number }[] = [];
  if (!cov) gaps.push({ left: 0, width: 100 });
  else {
    const a = axis.pct(tsMs(cov.primeiro));
    const b = axis.pct(tsMs(cov.ultimo));
    if (a > 0.05) gaps.push({ left: 0, width: a });
    const end = axis.pct(hEnd);
    if (b < end - 0.05) gaps.push({ left: b, width: 100 - b });
  }
  const fitLabel = (w: number) => (w / 100) * trackW > chPx * 11;
  const code = sourceCode(source);
  return (
    <>
      <span className="seis-lab" style={{ color: sourceColor(source) }} title={`${source}: ${total} eventos no filtro`}>
        {code}
      </span>
      <div className="seis-track" role="img" aria-label={`${code} ${source}: ${total} eventos no filtro${cov ? `, cobertura ${hhmm(tsMs(cov.primeiro))}–${hhmm(tsMs(cov.ultimo))}` : ', sem cobertura'}`}>
        {gaps.map((g, i) => (
          <div key={i} className="seis-gap hatch" style={{ left: `${g.left}%`, width: `${g.width}%` }}>
            {fitLabel(g.width) && <span className="seis-gap-lbl lbl">SEM DADOS</span>}
          </div>
        ))}
        <svg className="seis-svg" viewBox={`${axis.i0} 0 ${Math.max(1, axis.i1 - axis.i0)} 8`} preserveAspectRatio="none" aria-hidden>
          <path d={d} fill={sourceColor(source)} shapeRendering="crispEdges" />
        </svg>
        {marks.map((m) => (
          <span
            key={m.raw + m.ts}
            className={`seis-mark ${m.tipo === 'log_limpo' ? 'red' : ''}`}
            style={{ left: `${m.left}%` }}
            title={`${m.tipo === 'log_limpo' ? 'log limpo' : 'volume alto'} ${m.ts} ${m.raw}`}
          >
            {m.tipo === 'log_limpo' ? '✕' : '▲'}
          </span>
        ))}
      </div>
    </>
  );
});

export function Seismograph(props: Props) {
  const { hist, sources, windowDe, windowAte, cursorTs, visible, analystMarks, markSourceOf, onWindow, onPoint, modo, suspect } = props;
  const guiado = modo === 'guiado';
  // GUIADO começa com zoom no período suspeito; ANALISTA vê a janela total.
  const [zoom, setZoom] = useState(guiado);
  useEffect(() => setZoom(guiado), [guiado]);
  const zoomRange = zoom && suspect ? suspect : null;
  const chPx = useCharWidth();
  const [overlayRef, size] = useElementSize<HTMLDivElement>();
  const overlayEl = useRef<HTMLDivElement | null>(null);
  const setOverlay = useCallback(
    (el: HTMLDivElement | null) => {
      overlayEl.current = el;
      overlayRef(el);
    },
    [overlayRef],
  );
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const dragStart = useRef<number | null>(null);

  const axis = useMemo(() => (hist ? makeAxis(hist, zoomRange) : null), [hist, zoomRange]);
  const max = useMemo(() => {
    if (!hist) return 0;
    let m = 0;
    for (const arr of Object.values(hist.fontes)) for (const c of arr) if (c > m) m = c;
    return m;
  }, [hist]);

  const marksBySource = useMemo(() => {
    const out = new Map<string, { left: number; tipo: string; raw: string; ts: string }[]>();
    if (!hist || !axis) return out;
    for (const m of hist.marcas) {
      if (!axis.inView(tsMs(m.ts))) continue;
      const src = markSourceOf(m.raw_ref) ?? '';
      const arr = out.get(src) ?? [];
      arr.push({ left: axis.pct(tsMs(m.ts)), tipo: m.tipo, raw: m.raw_ref, ts: m.ts });
      out.set(src, arr);
    }
    return out;
  }, [hist, axis, markSourceOf]);

  const ticks = useMemo(() => {
    if (!axis || size.w <= 0) return [];
    const maxLabels = Math.max(2, Math.floor(size.w / (chPx * 9)));
    const spanMin = axis.span / 60000;
    const step = TICK_MIN.find((m) => spanMin / m <= maxLabels) ?? 1440;
    const stepMs = step * 60000;
    const out: { left: number; label: string }[] = [];
    for (let t = Math.ceil(axis.t0 / stepMs) * stepMs; t <= axis.t0 + axis.span; t += stepMs) {
      out.push({ left: axis.pct(t), label: hhmm(t) });
    }
    return out;
  }, [axis, size.w, chPx]);

  const msAt = (clientX: number): number => {
    const el = overlayEl.current;
    if (!el || !axis) return 0;
    const r = el.getBoundingClientRect();
    const x = Math.min(r.width, Math.max(0, clientX - r.left));
    return axis.t0 + (x / Math.max(1, r.width)) * axis.span;
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!axis || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = e.clientX;
    const ms = msAt(e.clientX);
    setDrag({ a: ms, b: ms });
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart.current == null) return;
    const ms = msAt(e.clientX);
    setDrag((d) => (d ? { a: d.a, b: ms } : d));
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    const d = drag;
    setDrag(null);
    if (start == null || !d) return;
    if (Math.abs(e.clientX - start) < 4) {
      onPoint(isoMs(msAt(e.clientX)));
      return;
    }
    const lo = Math.min(d.a, d.b);
    const hi = Math.max(d.a, d.b);
    onWindow(isoMs(Math.floor(lo / 1000) * 1000), isoMs(Math.ceil(hi / 1000) * 1000 - 1));
  };

  if (!hist || !axis) {
    return (
      <section className="seis seis-empty" aria-label="Sismógrafo por fonte">
        <span className="t3">SISMÓGRAFO ▮ CARREGANDO /histograma ...</span>
      </section>
    );
  }

  const hEnd = tsMs(hist.fim);
  const rows = sources.length;
  const winL = windowDe ? axis.pct(tsMs(windowDe)) : null;
  const winR = windowAte ? axis.pct(tsMs(windowAte)) : null;
  const hasWin = winL !== null || winR !== null;
  const cur = cursorTs && axis.inView(tsMs(cursorTs)) ? axis.pct(tsMs(cursorTs)) : null;
  const vis = visible ? [axis.pct(tsMs(visible[0])), axis.pct(tsMs(visible[1]))] : null;
  const fmtWin = (iso: string | null, fallback: string) => (iso ? iso.slice(11, 19) : fallback);

  return (
    <section
      className="seis"
      aria-label={`Sismógrafo por fonte${zoomRange ? ' (zoom no período suspeito)' : ''}`}
      style={{ gridTemplateRows: `repeat(${rows + 2}, var(--row-h))${guiado ? ' auto' : ''}` }}
    >
      {/* régua UTC */}
      <span className="seis-lab t3 lbl">UTC</span>
      <div className="seis-track seis-ruler" aria-hidden>
        {ticks.map((t) => (
          <span key={t.label + t.left} className="seis-tick t2" style={{ left: `${t.left}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      <span className="seis-side lbl t2">{zoomRange ? 'JANELA·ZOOM' : 'JANELA'}</span>

      {sources.map((src, i) => (
        <SourceRowWithSide
          key={src}
          i={i}
          side={
            i === 0 ? (
              <span className={hasWin ? 'amber' : 't3'}>{fmtWin(windowDe, hhmm(axis.t0))}</span>
            ) : i === 1 ? (
              <span className={hasWin ? 'amber' : 't3'}>→{fmtWin(windowAte, hhmm(Math.min(hEnd, axis.t0 + axis.span)))}</span>
            ) : i === 2 ? (
              <span className="lbl t2">
                <span className="num-data">{analystMarks.length}</span> MARCAS
              </span>
            ) : i === 3 ? (
              <span className="lbl t3">BALDE {hist.bucket_s}S</span>
            ) : null
          }
        >
          <SourceRow
            source={src}
            counts={hist.fontes[src]}
            n={hist.n_baldes}
            max={max}
            axis={axis}
            cov={hist.cobertura[src]}
            hEnd={hEnd}
            marks={marksBySource.get(src) ?? []}
            trackW={size.w}
            chPx={chPx}
          />
        </SourceRowWithSide>
      ))}

      {/* régua inferior: cursor ▲, faixa visível, marcas do analista */}
      <span className="seis-lab" aria-hidden />
      <div className="seis-track seis-foot" aria-hidden>
        <div className="seis-foot-rule" />
        {vis && <div className="seis-visible" style={{ left: `${vis[0]}%`, width: `${Math.max(0.3, vis[1]! - vis[0]!)}%` }} />}
        {hasWin && <div className="seis-win-foot" style={{ left: `${winL ?? 0}%`, width: `${(winR ?? 100) - (winL ?? 0)}%` }} />}
        {analystMarks.filter((ts) => axis.inView(tsMs(ts))).map((ts, k) => (
          <span key={ts + k} className="seis-amark amber" style={{ left: `${axis.pct(tsMs(ts))}%` }}>
            *
          </span>
        ))}
        {cur !== null && (
          <span className="seis-cursor amber" style={{ left: `${cur}%` }}>
            ▲
          </span>
        )}
        {(marksBySource.get('') ?? []).map((m) => (
          <span key={m.raw} className={`seis-mark ${m.tipo === 'log_limpo' ? 'red' : ''}`} style={{ left: `${m.left}%` }}>
            {m.tipo === 'log_limpo' ? '✕' : '▲'}
          </span>
        ))}
      </div>
      <span className="seis-side t3">{visible ? `${visible[0].slice(11, 16)}→${visible[1].slice(11, 16)}` : ''}</span>

      {/* camada de interação: arrastar = janela; clique = ir */}
      <div
        ref={setOverlay}
        className="seis-overlay"
        style={{ gridRow: `2 / span ${rows + 1}` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          dragStart.current = null;
          setDrag(null);
        }}
        title="arraste para definir a janela · clique para ir ao horário"
      >
        {hasWin && <div className="seis-win" style={{ left: `${winL ?? 0}%`, width: `${(winR ?? 100) - (winL ?? 0)}%` }} />}
        {drag && Math.abs(drag.b - drag.a) > 0 && (
          <div
            className="seis-drag"
            style={{ left: `${axis.pct(Math.min(drag.a, drag.b))}%`, width: `${Math.abs(axis.pct(drag.b) - axis.pct(drag.a))}%` }}
          >
            <span className="seis-drag-lbl">
              {hhmm(Math.min(drag.a, drag.b))}–{hhmm(Math.max(drag.a, drag.b))}
            </span>
          </div>
        )}
        {cur !== null && <div className="seis-cursor-line" style={{ left: `${cur}%` }} />}
      </div>
      {guiado && (
        <div className="seis-legend" style={{ gridRow: rows + 3 }}>
          {guiado && (
            <span className="t2">
              barras = quantidade de eventos · <span className="hatch seis-hatch-inline">░</span> hachura = sem coleta nesta fonte ·{' '}
              <span className="red">✕</span> log apagado · ▲ envio de grande volume · arraste para escolher um período
            </span>
          )}
          {suspect && (
            <button type="button" className="btn-stamp seis-zoom" onClick={() => setZoom((z) => !z)}>
              {zoomRange ? '[ver caso inteiro]' : '[ver período suspeito]'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function SourceRowWithSide({ children, side }: { children: React.ReactNode; side: React.ReactNode; i: number }) {
  return (
    <>
      {children}
      <span className="seis-side">{side}</span>
    </>
  );
}
