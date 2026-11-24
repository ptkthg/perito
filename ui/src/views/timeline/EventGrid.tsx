// Tabela virtualizada (TanStack Virtual) com altura de linha FIXA.
// role="grid", aria-rowcount real (cabeçalho + separadores de dia + eventos), roving tabindex.
// Seleção (barra ▌ + --sel-bg) é distinta do foco (outline ciano na célula).
import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PeritoEvent } from '../../lib/types';
import { dayOf, daySeparator, sourceCode, sourceColor, splitTs, truncateMiddle, typeCode } from '../../lib/format';
import { useCharWidth, useElementSize } from '../../lib/hooks';
import { COLS, attackCell, eventFlags, hostDisplay, signalWords } from './cells';
import { type Modo, sourceLong, typePt } from '../../lib/mode';
import { type TacticOf, tecnicaPt } from '../../lib/attack-pt';

export interface EventGridHandle {
  /** Rola até o evento i e, se pedido, move o foco do DOM para a célula (i, c). */
  reveal(i: number, c: number, focus: boolean): void;
  hasFocus(): boolean;
}

interface Props {
  events: PeritoEvent[];
  cur: number;
  col: number;
  rowH: number;
  marked: ReadonlySet<string>;
  searchTerm: string;
  /** Eventos destacados (refs de hipóteses/achados). */
  highlight: ReadonlySet<number> | null;
  modo: Modo;
  tacticOf: TacticOf;
  onCursor(cur: number, col: number): void;
  onActivate(cur: number): void;
  onVisible(range: [string, string] | null): void;
  empty: React.ReactNode;
}

/** rows[r] >= 0 → índice do evento; rows[r] < 0 → separador do dia days[-rows[r]-1]. */
function buildRows(events: PeritoEvent[]) {
  const rows: number[] = [];
  const days: string[] = [];
  const rowOf = new Int32Array(events.length);
  let prev = '';
  for (let i = 0; i < events.length; i++) {
    const d = dayOf(events[i]!.ts_utc);
    if (d !== prev) {
      days.push(d);
      rows.push(-days.length);
      prev = d;
    }
    rowOf[i] = rows.length;
    rows.push(i);
  }
  return { rows, days, rowOf };
}

interface RowProps {
  ev: PeritoEvent;
  i: number;
  r: number;
  top: number;
  sel: boolean;
  col: number;
  marked: boolean;
  resumoChars: number;
  hit: boolean;
  guiado: boolean;
  tacticOf: TacticOf;
  onCell(i: number, c: number): void;
  onActivate(i: number): void;
}

const Row = memo(function Row({ ev, i, r, top, sel, col, marked, resumoChars, hit, guiado, tacticOf, onCell, onActivate }: RowProps) {
  const { hms, ms } = splitTs(ev.ts_utc);
  const host = hostDisplay(ev);
  const att = attackCell(ev, tacticOf);
  const fl = eventFlags(ev);
  const resumo = ev.description ?? ev.cmdline ?? ev.action ?? '';
  const tab = (c: number) => (sel && col === c ? 0 : -1);
  const cell = (c: number) => ({
    role: 'gridcell' as const,
    tabIndex: tab(c),
    'data-col': c,
    'aria-colindex': c + 1,
    onMouseDown: () => onCell(i, c),
  });
  const words = guiado ? signalWords(ev, marked) : [];
  return (
    <div
      role="row"
      aria-rowindex={r + 2}
      aria-selected={sel}
      className={`row${sel ? ' is-sel' : ''}${hit ? ' is-hit' : ''}`}
      style={{ transform: `translateY(${top}px)`, borderLeftColor: sourceColor(ev.source) }}
      data-i={i}
      onDoubleClick={() => onActivate(i)}
    >
      <span className="c-gut amber" aria-hidden>
        {sel ? '▌' : ''}
      </span>
      <span {...cell(0)} className="c">
        {hms}
        <span className="t3">{ms}</span>
      </span>
      <span {...cell(1)} className="c ellip" style={{ color: sourceColor(ev.source) }} title={ev.source}>
        {guiado ? sourceLong(ev.source) : sourceCode(ev.source)}
      </span>
      <span {...cell(2)} className="c t2 ellip" title={ev.event_type}>
        {guiado ? typePt(ev.event_type) : typeCode(ev.event_type)}
      </span>
      <span
        {...cell(3)}
        className={`c ellip${host.deduced ? ' deduced' : ''}${host.empty ? ' t3' : ''}`}
        title={host.deduced ? 'máquina deduzida pelo IP de origem' : undefined}
      >
        {host.text}
      </span>
      <span {...cell(4)} className={`c ellip${ev.user ? '' : ' t3'}`}>
        {ev.user ?? '—'}
      </span>
      <span {...cell(5)} className="c clip" title={resumo.length > resumoChars ? resumo : undefined}>
        {resumo ? truncateMiddle(resumo, resumoChars) : <span className="t3">—</span>}
      </span>
      <span {...cell(6)} className="c ellip" title={att ? ev.mitre.map((t) => `${t} ${tecnicaPt(t)}`).join(' · ') : undefined}>
        {att ? (
          <>
            {guiado ? tecnicaPt(att.text) : att.text}
            {att.heur && <span className="amber">?</span>}
            {att.more > 0 && <span className="t3">+{att.more}</span>}
          </>
        ) : (
          <span className="t3">—</span>
        )}
      </span>
      {guiado ? (
        <span {...cell(7)} className="c ellip t2" title={words.join(' · ') || undefined}>
          {words.length ? words.join(' · ') : <span className="t3">·</span>}
        </span>
      ) : (
        <span {...cell(7)} className="c flag">
          {marked && <span className="g amber">*</span>}
          {fl.corrob > 0 && (
            <span>
              <span className="g">≡</span>
              {fl.corrob}
            </span>
          )}
          {fl.volume && <span className="g">▲</span>}
          {fl.observer && <span className="g">⊙</span>}
          {!marked && !fl.corrob && !fl.volume && !fl.observer && <span className="t3">·</span>}
        </span>
      )}
    </div>
  );
});

export const EventGrid = forwardRef<EventGridHandle, Props>(function EventGrid(props, ref) {
  const { events, cur, col, rowH, marked, searchTerm, highlight, modo, tacticOf, onCursor, onActivate, onVisible, empty } = props;
  const guiado = modo === 'guiado';
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const wantFocus = useRef<{ i: number; c: number } | null>(null);
  const chPx = useCharWidth();
  const [resumoHeadRef, resumoSize] = useElementSize<HTMLSpanElement>();
  const resumoChars = Math.max(8, Math.floor((resumoSize.w - 16) / chPx));

  const { rows, days, rowOf } = useMemo(() => buildRows(events), [events]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 24,
  });

  useEffect(() => {
    virt.measure();
  }, [rowH, virt]);

  // Mantém o cursor visível quando ele muda (teclado, comando `ir`, pivô).
  useEffect(() => {
    if (events.length === 0) return;
    const r = rowOf[Math.min(cur, events.length - 1)] ?? 0;
    virt.scrollToIndex(r, { align: 'auto' });
  }, [cur, events, rowOf, virt]);

  // Foco do DOM na célula ativa depois da renderização.
  const focusCell = (i: number, c: number): boolean => {
    const el = gridRef.current?.querySelector<HTMLElement>(`.row[data-i="${i}"] [data-col="${c}"]`);
    if (!el) return false;
    el.focus({ preventScroll: true });
    return true;
  };
  useLayoutEffect(() => {
    const w = wantFocus.current;
    if (w && focusCell(w.i, w.c)) wantFocus.current = null;
  });

  useImperativeHandle(ref, () => ({
    reveal(i: number, c: number, focus: boolean) {
      if (events.length === 0) {
        if (focus) gridRef.current?.focus();
        return;
      }
      const r = rowOf[Math.max(0, Math.min(i, events.length - 1))] ?? 0;
      virt.scrollToIndex(r, { align: 'auto' });
      if (focus && !focusCell(i, c)) {
        wantFocus.current = { i, c };
        gridRef.current?.focus({ preventScroll: true });
      }
    },
    hasFocus: () => !!gridRef.current?.contains(document.activeElement),
  }));

  // Faixa de horário visível na tabela → sismógrafo.
  const items = virt.getVirtualItems();
  const offset = virt.scrollOffset ?? 0;
  const viewH = virt.scrollRect?.height ?? 0;
  const firstRow = Math.max(0, Math.floor(offset / rowH));
  const lastRow = Math.min(rows.length - 1, Math.floor((offset + viewH - 1) / rowH));
  const evAt = (r: number, dir: 1 | -1): PeritoEvent | null => {
    for (let k = r; k >= 0 && k < rows.length; k += dir) {
      const v = rows[k]!;
      if (v >= 0) return events[v] ?? null;
    }
    return null;
  };
  const vA = rows.length ? evAt(firstRow, 1) : null;
  const vB = rows.length ? evAt(lastRow, -1) : null;
  // Quantizado ao minuto (resolução do sismógrafo): evita re-render do pai a cada quadro de rolagem.
  const visKey = vA && vB ? `${vA.ts_utc.slice(0, 16)}:00.000Z|${vB.ts_utc.slice(0, 16)}:59.999Z` : '';
  useEffect(() => {
    if (!visKey) onVisible(null);
    else {
      const [a, b] = visKey.split('|') as [string, string];
      onVisible([a, b]);
    }
  }, [visKey, onVisible]);

  // Destaque da busca incremental (só nas linhas visíveis; barato).
  const term = searchTerm.toLowerCase();
  const isHit = (ev: PeritoEvent) =>
    !!highlight?.has(ev.idx) ||
    (!!term &&
    [ev.description, ev.cmdline, ev.host, ev.user, ev.src_ip, ev.dst_ip, ev.domain, ev.file_path, ev.raw_ref].some((v) => v?.toLowerCase().includes(term)));

  return (
    <div
      className={`grid${guiado ? ' is-guided' : ''}`}
      role="grid"
      aria-label="Timeline de eventos"
      aria-rowcount={rows.length + 1}
      aria-colcount={COLS.length}
      aria-readonly="true"
      ref={gridRef}
      tabIndex={-1}
    >
      <div role="rowgroup" className="grid-head-wrap">
        <div role="row" aria-rowindex={1} className="row row-head">
          <span className="c-gut" aria-hidden />
          {COLS.map((c, k) => (
            <span
              key={c.key}
              role="columnheader"
              aria-colindex={k + 1}
              className={`c lbl${k === col ? ' is-col' : ''}`}
              ref={c.key === 'resumo' ? resumoHeadRef : undefined}
            >
              {guiado ? c.guiado : c.label}
            </span>
          ))}
        </div>
      </div>
      <div className="grid-scroll" ref={scrollRef}>
        {events.length === 0 ? (
          <div className="grid-empty">{empty}</div>
        ) : (
          <div role="rowgroup" className="grid-body" style={{ height: virt.getTotalSize() }}>
            {items.map((it) => {
              const v = rows[it.index]!;
              if (v < 0) {
                const day = days[-v - 1]!;
                return (
                  <div key={`d${day}`} role="row" aria-rowindex={it.index + 2} className="row row-day" style={{ transform: `translateY(${it.start}px)` }}>
                    <span role="gridcell" aria-colspan={COLS.length} className="t3">
                      {daySeparator(day)}
                    </span>
                  </div>
                );
              }
              const ev = events[v]!;
              return (
                <Row
                  key={ev.idx}
                  ev={ev}
                  i={v}
                  r={it.index}
                  top={it.start}
                  sel={v === cur}
                  col={v === cur ? col : -1}
                  marked={marked.has(ev.raw_ref)}
                  resumoChars={resumoChars}
                  hit={isHit(ev)}
                  guiado={guiado}
                  tacticOf={tacticOf}
                  onCell={onCursor}
                  onActivate={onActivate}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
