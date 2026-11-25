// F1 TIMELINE: sismógrafo + faixa FILTRO + tabela virtualizada + detalhe.
// Teclado próprio exposto via handle (o CaseShell repassa as teclas quando a visão está ativa).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { EventosResp, Histograma, PeritoEvent, Resumo } from '../../lib/types';
import { type Clause, type FilterField, type FilterState, describeClause, describeWindow } from '../../lib/filters';
import { SOURCE_ORDER, sourceCode, tsMs } from '../../lib/format';
import { copyText } from '../../lib/clipboard';
import { loadMarcas, saveMarcas } from '../../lib/prefs';
import type { PromptMode } from '../../components/CommandLine';
import { EventGrid, type EventGridHandle } from './EventGrid';
import { Seismograph } from './Seismograph';
import { DetailPanel } from './DetailPanel';
import { COLS, cellCopyValue, cellTarget, coverageNotes, markSource, searchHaystack } from './cells';
import { type Modo, loadDicaOculta, saveDicaOculta } from '../../lib/mode';
import { makeTacticOf } from '../../lib/attack-pt';
import { isEmptyFilter } from '../../lib/filters';
import { PromoteForm } from '../bench/PromoteForm';
import { LinkHypForm } from '../bench/LinkHypForm';

export interface TimelineHandle {
  /** Trata a tecla; devolve true se consumiu. */
  onKey(e: KeyboardEvent): boolean;
  goTo(ts: string): string;
  top(): void;
  focus(): void;
  search(term: string): void;
  searchCommit(term: string): void;
  searchCancel(): void;
  /** Esc em camadas: devolve true se consumiu (soltou detalhe / limpou busca). */
  escape(): boolean;
  /** Seleciona e destaca eventos (idx) vindos de refs; devolve quantos estão na lista atual. */
  focusEvents(idxs: number[], rotulo: string, fixar?: boolean): number;
  /** Abre a bancada (promover/vincular) no evento selecionado. */
  abrirBancada(tipo: 'achado' | 'hip', textoInicial?: string): void;
}

export type MsgKind = 'ok' | 'err' | 'info';

interface Props {
  caso: string;
  resp: EventosResp | null;
  loading: boolean;
  error: string | null;
  hist: Histograma | null;
  resumo: Resumo | null;
  filter: FilterState;
  rowH: number;
  onPivot(field: FilterField, value: string, via: string): void;
  onClause(c: Clause, via: string): void;
  onRemoveClause(i: number): void;
  onClearWindow(): void;
  onWindow(de: string, ate: string): void;
  onMsg(text: string, kind?: MsgKind): void;
  onPrompt(prefill: string, mode: PromptMode): void;
  modo: Modo;
  onOverview(): void;
  /** Revisão dos dados do caso (sobe a cada escrita/ingestão). */
  rev: number;
  /** Escrita concluída: mensagem de status (o shell recarrega os dados e oferece [o] F6). */
  onEscrito(msg: string): void;
}

/** Posição do evento com idx mais próximo (lista filtrada é ordenada por idx). */
function findByIdx(events: PeritoEvent[], idx: number): number {
  let lo = 0;
  let hi = events.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.idx < idx) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo);
}

/** Posição do evento mais próximo de um horário (ms). */
function nearestTs(events: PeritoEvent[], ms: number): number {
  if (events.length === 0) return 0;
  let lo = 0;
  let hi = events.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tsMs(events[mid]!.ts_utc) < ms) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(tsMs(events[lo - 1]!.ts_utc) - ms) <= Math.abs(tsMs(events[lo]!.ts_utc) - ms)) return lo - 1;
  return lo;
}

export const Timeline = forwardRef<TimelineHandle, Props>(function Timeline(props, ref) {
  const { caso, resp, loading, error, hist, resumo, filter, rowH, onPivot, onClause, onRemoveClause, onClearWindow, onWindow, onMsg, onPrompt, modo, onOverview, rev, onEscrito } = props;
  const [bancada, setBancada] = useState<{ tipo: 'achado' | 'hip'; ev: PeritoEvent; texto?: string } | null>(null);
  const guiado = modo === 'guiado';
  const [dicaOculta, setDicaOculta] = useState(loadDicaOculta);
  const tacticOf = useMemo(() => makeTacticOf(resumo?.tecnicas), [resumo]);
  const events = useMemo(() => resp?.eventos ?? [], [resp]);
  const [cur, setCur] = useState(0);
  const [col, setCol] = useState(0);
  const [pinned, setPinned] = useState<PeritoEvent | null>(null);
  const [marks, setMarks] = useState<Set<string>>(() => loadMarcas(caso));
  const [visible, setVisible] = useState<[string, string] | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [destaque, setDestaque] = useState<{ idxs: Set<number>; rotulo: string } | null>(null);
  const searchOrigin = useRef(0);
  const selIdx = useRef<number | null>(null);
  const gridRef = useRef<EventGridHandle>(null);
  const colRef = useRef(0);
  colRef.current = col;

  // Mantém a seleção no mesmo evento (idx) quando o filtro muda.
  useEffect(() => {
    if (events.length === 0) {
      setCur(0);
      return;
    }
    const pos = selIdx.current == null ? 0 : findByIdx(events, selIdx.current);
    setCur(Math.min(pos, events.length - 1));
  }, [events]);

  useEffect(() => {
    const ev = events[cur];
    if (ev) selIdx.current = ev.idx;
  }, [cur, events]);

  const haystacks = useRef<{ evs: PeritoEvent[]; hs: string[] } | null>(null);
  const getHay = useCallback(() => {
    if (!haystacks.current || haystacks.current.evs !== events) {
      haystacks.current = { evs: events, hs: events.map(searchHaystack) };
    }
    return haystacks.current.hs;
  }, [events]);

  // Período de atividade suspeita (1º ao último evento com técnica), medido sem filtro.
  const [suspect, setSuspect] = useState<[string, string] | null>(null);
  useEffect(() => {
    if (!isEmptyFilter(filter) || events.length === 0) return;
    let a: string | null = null;
    let b: string | null = null;
    for (const e of events) {
      if (e.mitre.length === 0) continue;
      if (!a) a = e.ts_utc;
      b = e.ts_utc;
    }
    setSuspect((old) => (a && b ? (old && old[0] === a && old[1] === b ? old : [a, b]) : null));
  }, [events, filter]);

  const techNames = useMemo(() => new Map((resumo?.tecnicas ?? []).map((t) => [t.id, t.nome])), [resumo]);

  const byRef = useMemo(() => {
    const m = new Map<string, PeritoEvent>();
    for (const e of events) m.set(e.raw_ref, e);
    return m;
  }, [events]);

  const sources = useMemo(() => {
    const present = new Set<string>([...Object.keys(hist?.fontes ?? {}), ...Object.keys(hist?.cobertura ?? {}), ...Object.keys(resumo?.por_fonte ?? {})]);
    const ordered = SOURCE_ORDER.filter((s) => present.has(s));
    for (const s of [...present].sort()) if (!ordered.includes(s)) ordered.push(s);
    return ordered.length ? ordered : SOURCE_ORDER;
  }, [hist, resumo]);

  const markSourceOf = useCallback((raw: string) => markSource(raw, byRef, sources), [byRef, sources]);

  const analystMarks = useMemo(() => (marks.size ? events.filter((e) => marks.has(e.raw_ref)).map((e) => e.ts_utc) : []), [events, marks]);

  const move = useCallback(
    (to: number, c?: number) => {
      if (events.length === 0) return;
      const n = Math.max(0, Math.min(events.length - 1, to));
      const nc = c === undefined ? colRef.current : Math.max(0, Math.min(COLS.length - 1, c));
      setCur(n);
      setCol(nc);
      gridRef.current?.reveal(n, nc, true);
    },
    [events.length],
  );

  const current = events[cur] ?? null;
  const detailEv = pinned ?? current;
  const detailPos = pinned ? events.findIndex((e) => e.idx === pinned.idx) : cur;

  const searchNext = useCallback(
    (dir: 1 | -1, from: number, term: string, inclusive: boolean): number => {
      const t = term.toLowerCase();
      if (!t || events.length === 0) return -1;
      const hs = getHay();
      const n = hs.length;
      for (let k = inclusive ? 0 : 1; k <= n; k++) {
        const i = (((from + dir * k) % n) + n) % n;
        if (hs[i]!.includes(t)) return i;
      }
      return -1;
    },
    [events.length, getHay],
  );

  const countHits = useCallback(
    (term: string, upto: number) => {
      const t = term.toLowerCase();
      const hs = getHay();
      let total = 0;
      let pos = 0;
      for (let i = 0; i < hs.length; i++) {
        if (hs[i]!.includes(t)) {
          total++;
          if (i <= upto) pos = total;
        }
      }
      return { total, pos };
    },
    [getHay],
  );

  const copy = useCallback(
    async (label: string, value: string | null) => {
      if (!value) {
        onMsg(`${label} vazio — nada copiado`, 'err');
        return;
      }
      const ok = await copyText(value);
      onMsg(ok ? `copiado ${label}: ${value}` : `falha ao copiar ${label}`, ok ? 'ok' : 'err');
    },
    [onMsg],
  );

  const jumpMark = useCallback(
    (dir: 1 | -1) => {
      if (!marks.size) {
        onMsg('nenhuma marca — m marca o evento selecionado', 'info');
        return;
      }
      const n = events.length;
      for (let k = 1; k <= n; k++) {
        const i = (((cur + dir * k) % n) + n) % n;
        if (marks.has(events[i]!.raw_ref)) {
          move(i);
          onMsg(`marca ${events[i]!.ts_utc} ${events[i]!.raw_ref}`, 'info');
          return;
        }
      }
      onMsg('nenhuma marca na timeline filtrada', 'info');
    },
    [marks, events, cur, move, onMsg],
  );

  const toggleMark = useCallback(
    (ev: PeritoEvent) => {
      const next = new Set(marks);
      const had = next.has(ev.raw_ref);
      if (had) next.delete(ev.raw_ref);
      else next.add(ev.raw_ref);
      setMarks(next);
      saveMarcas(caso, next);
      onMsg(`${had ? 'marca removida' : 'marcado'} ${ev.raw_ref} · ${next.size} marcas`, 'ok');
    },
    [marks, caso, onMsg],
  );

  useImperativeHandle(
    ref,
    () => ({
      onKey(e: KeyboardEvent): boolean {
        const ev = events[cur];
        const page = Math.max(1, Math.floor((window.innerHeight * 0.5) / rowH));
        switch (e.key) {
          case 'j':
          case 'ArrowDown':
            move(cur + 1);
            return true;
          case 'k':
          case 'ArrowUp':
            move(cur - 1);
            return true;
          case 'J':
            move(cur + 10);
            return true;
          case 'K':
            move(cur - 10);
            return true;
          case 'PageDown':
            move(cur + page);
            return true;
          case 'PageUp':
            move(cur - page);
            return true;
          case 'G':
          case 'End':
            move(events.length - 1);
            return true;
          case 'Home':
            move(0);
            return true;
          case 'h':
          case 'ArrowLeft':
            move(cur, col - 1);
            return true;
          case 'l':
          case 'ArrowRight':
            move(cur, col + 1);
            return true;
          case 'Enter':
            if (ev) {
              setPinned(ev);
              onMsg(`detalhe fixo em ${ev.ts_utc} ${ev.raw_ref} · Esc solta`, 'info');
            }
            return true;
          case 'p': {
            if (!ev) return true;
            const t = cellTarget(ev, COLS[col]!.key, 'pivo');
            if ('error' in t) onMsg(t.error, 'err');
            else onPivot(t.field, t.value, t.via);
            return true;
          }
          case 'f':
          case 'F': {
            if (!ev) return true;
            const t = cellTarget(ev, COLS[col]!.key, 'filtro');
            if ('error' in t) onMsg(t.error.replace('sem pivô', 'sem filtro'), 'err');
            else onClause({ field: t.field, neg: e.key === 'F', value: t.value }, t.via);
            return true;
          }
          case 'y':
            if (ev) void copy(guiado ? COLS[col]!.guiado : COLS[col]!.label, cellCopyValue(ev, COLS[col]!.key, tacticOf));
            return true;
          case 'x':
            if (ev) void copy('raw_ref', ev.raw_ref);
            return true;
          case 'm':
            if (ev) toggleMark(ev);
            return true;
          case ']':
            jumpMark(1);
            return true;
          case '[':
            jumpMark(-1);
            return true;
          case 'n':
          case 'N': {
            if (!searchTerm && destaque) {
              const n = events.length;
              const dir = e.key === 'n' ? 1 : -1;
              for (let k = 1; k <= n; k++) {
                const i = (((cur + dir * k) % n) + n) % n;
                if (destaque.idxs.has(events[i]!.idx)) {
                  move(i);
                  const lista = events.filter((x) => destaque.idxs.has(x.idx));
                  onMsg(`${destaque.rotulo}: ${lista.findIndex((x) => x.idx === events[i]!.idx) + 1}/${lista.length} · n/N próximo · Esc limpa`, 'info');
                  break;
                }
              }
              return true;
            }
            if (!searchTerm) {
              onMsg('sem busca ativa — / inicia', 'info');
              return true;
            }
            const i = searchNext(e.key === 'n' ? 1 : -1, cur, searchTerm, false);
            if (i < 0) onMsg(`/${searchTerm} — 0 ocorrências`, 'err');
            else {
              move(i);
              const { total, pos } = countHits(searchTerm, i);
              onMsg(`/${searchTerm}  ${pos}/${total}`, 'info');
            }
            return true;
          }
          case '/':
            searchOrigin.current = cur;
            onPrompt('', 'search');
            return true;
          case 't':
            onPrompt('ir ', 'cmd');
            return true;
          case 'a':
            if (ev) setBancada({ tipo: 'achado', ev });
            return true;
          case 'H':
            if (ev) setBancada({ tipo: 'hip', ev });
            return true;
          default:
            return false;
        }
      },
      goTo(ts: string): string {
        if (events.length === 0) return '0 eventos no filtro — nada para ir';
        const i = nearestTs(events, tsMs(ts));
        move(i);
        const e = events[i]!;
        const dt = Math.round((tsMs(e.ts_utc) - tsMs(ts)) / 1000);
        return `ir ${ts} → ${e.ts_utc} (${dt >= 0 ? '+' : ''}${dt}s) ${sourceCode(e.source)} ${e.raw_ref}`;
      },
      top() {
        move(0);
      },
      focus() {
        gridRef.current?.reveal(cur, col, true);
      },
      search(term: string) {
        setSearchTerm(term);
        if (!term) {
          move(searchOrigin.current);
          onMsg('/', 'info');
          return;
        }
        const i = searchNext(1, searchOrigin.current, term, true);
        if (i < 0) onMsg(`/${term} — 0 ocorrências na timeline filtrada`, 'err');
        else {
          setCur(i);
          gridRef.current?.reveal(i, col, false);
          const { total, pos } = countHits(term, i);
          onMsg(`/${term}  ${pos}/${total}`, 'info');
        }
      },
      searchCommit(term: string) {
        setSearchTerm(term);
        if (term) onMsg(`/${term} · n/N próximo/anterior · Esc limpa o destaque`, 'info');
      },
      searchCancel() {
        setSearchTerm('');
        move(searchOrigin.current);
        onMsg('busca cancelada', 'info');
      },
      escape(): boolean {
        if (pinned) {
          setPinned(null);
          onMsg('detalhe solto (segue o cursor)', 'info');
          return true;
        }
        if (searchTerm) {
          setSearchTerm('');
          onMsg('destaque da busca limpo', 'info');
          return true;
        }
        if (destaque) {
          setDestaque(null);
          onMsg('destaque das evidências limpo', 'info');
          return true;
        }
        return false;
      },
      abrirBancada(tipo: 'achado' | 'hip', textoInicial?: string) {
        const alvo = events[cur];
        if (alvo) setBancada({ tipo, ev: alvo, texto: textoInicial });
        else onMsg('nenhum evento selecionado para a bancada', 'err');
      },
      focusEvents(idxs: number[], rotulo: string, fixar = false): number {
        const set = new Set(idxs);
        const presentes = events.filter((x) => set.has(x.idx));
        setDestaque({ idxs: set, rotulo });
        setSearchTerm('');
        if (presentes.length === 0) return 0;
        const i = events.indexOf(presentes[0]!);
        selIdx.current = presentes[0]!.idx;
        if (fixar) setPinned(presentes[0]!);
        move(i);
        return presentes.length;
      },
    }),
    [events, cur, col, rowH, move, onMsg, onPivot, onClause, copy, jumpMark, searchTerm, searchNext, countHits, onPrompt, pinned, guiado, tacticOf, toggleMark, destaque],
  );

  const onCursor = useCallback((i: number, c: number) => {
    setCur(i);
    setCol(c);
  }, []);
  const onActivate = useCallback(
    (i: number) => {
      const ev = events[i];
      if (ev) setPinned(ev);
    },
    [events],
  );
  const onPoint = useCallback(
    (ts: string) => {
      if (events.length === 0) return;
      const i = nearestTs(events, tsMs(ts));
      move(i);
      onMsg(`sismógrafo → ${events[i]!.ts_utc}`, 'info');
    },
    [events, move, onMsg],
  );

  const total = resp?.total ?? resumo?.total_eventos ?? 0;
  const filtrados = resp?.filtrados ?? 0;
  const win = describeWindow(filter);
  const hasFilter = filter.clauses.length > 0 || !!win;

  // Estado vazio cruzado com a cobertura.
  const empty = (() => {
    if (error) {
      return (
        <p className="inline-state red" role="alert">
          ERRO {error} <span className="t3">[u] desfaz último filtro</span>
        </p>
      );
    }
    if (!resp) return <p className="inline-state t2">CARREGANDO /eventos ...</p>;
    const desc = [...filter.clauses.map(describeClause), ...(win ? [win] : [])].join(' ∧ ') || 'caso inteiro';
    const notes = coverageNotes(filter, hist, resumo);
    return (
      <div className="inline-state">
        <p>
          <span className="lbl">0 EVENTOS</span> para <span className="amber">{desc}</span>
        </p>
        {notes.map((n) => (
          <p key={n} className={n.startsWith('⊘') ? 'lim-note' : 't2'}>
            {n.startsWith('⊘') ? <span className="stamp stamp-lim hatch">{n}</span> : n}
          </p>
        ))}
        <p className="t3">[u] desfaz último filtro · limpar remove todos</p>
      </div>
    );
  })();

  return (
    <div data-tour="evento" className={`tl${pinned ? ' is-pinned' : ''}${bancada ? ' has-bancada' : ''}`}>
      <Seismograph
        hist={hist}
        sources={sources}
        windowDe={filter.de}
        windowAte={filter.ate}
        cursorTs={detailEv?.ts_utc ?? null}
        visible={visible}
        analystMarks={analystMarks}
        markSourceOf={markSourceOf}
        onWindow={onWindow}
        onPoint={onPoint}
        modo={modo}
        suspect={suspect}
      />
      <div className="tl-body">
        <div className="tl-main">
          <div className="strip" role="region" aria-label="Filtros ativos">
            <span className="lbl t2">FILTRO</span>
            <span className="strip-clauses">
              {!hasFilter && <span className="t3">nenhum — caso inteiro</span>}
              {filter.clauses.map((c, i) => (
                <span key={`${c.field}${c.neg}${c.value}`} className="strip-item">
                  {i > 0 && <span className="t3"> ∧ </span>}
                  <button type="button" className="clause" onClick={() => onRemoveClause(i)} title="remover este filtro">
                    {describeClause(c)}
                  </button>
                </span>
              ))}
              {win && (
                <span className="strip-item">
                  {filter.clauses.length > 0 && <span className="t3"> ∧ </span>}
                  <button type="button" className="clause amber" onClick={onClearWindow} title="remover a janela">
                    {win}
                  </button>
                </span>
              )}
            </span>
            <span className="strip-count">
              {loading && <span className="t3">CARREGANDO … </span>}
              <span className="num-data">
                {filtrados}/{total}
              </span>{' '}
              <span className="lbl">EVT</span>
            </span>
          </div>
          {guiado && !dicaOculta && (
            <div className="hint" role="note">
              <span className="t2">
                Clique numa linha para ver os detalhes ·{' '}
                <button type="button" className="pivot" onClick={onOverview}>
                  F0 Visão Geral
                </button>{' '}
                conta a história do caso · ? mostra todos os atalhos
              </span>
              <button
                type="button"
                className="hint-x"
                aria-label="Dispensar dica"
                title="dispensar dica"
                onClick={() => {
                  setDicaOculta(true);
                  saveDicaOculta(true);
                }}
              >
                ×
              </button>
            </div>
          )}
          <EventGrid
            ref={gridRef}
            modo={modo}
            tacticOf={tacticOf}
            events={events}
            cur={cur}
            col={col}
            rowH={rowH}
            marked={marks}
            searchTerm={searchTerm}
            highlight={destaque?.idxs ?? null}
            onCursor={onCursor}
            onActivate={onActivate}
            onVisible={setVisible}
            empty={empty}
          />
        </div>
        <DetailPanel
          ev={detailEv}
          pos={detailPos}
          total={events.length}
          pinned={!!pinned}
          marked={!!detailEv && marks.has(detailEv.raw_ref)}
          techNames={techNames}
          modo={modo}
          tacticOf={tacticOf}
          onFilter={(field, value) => onClause({ field, neg: false, value }, 'DETALHE')}
          onPromover={() => detailEv && setBancada({ tipo: 'achado', ev: detailEv })}
          onVincular={() => detailEv && setBancada({ tipo: 'hip', ev: detailEv })}
          bancada={
            bancada ? (
              bancada.tipo === 'achado' ? (
                <PromoteForm
                  key={`a${bancada.ev.idx}`}
                  caso={caso}
                  ev={bancada.ev}
                  modo={modo}
                  tacticOf={tacticOf}
                  textoInicial={bancada.texto}
                  onMsg={onMsg}
                  onFechar={() => {
                    setBancada(null);
                    gridRef.current?.reveal(cur, col, true);
                  }}
                  onSalvo={(id) => {
                    setBancada(null);
                    onEscrito(`✓ ACHADO ${id} gravado → achados.md`);
                    gridRef.current?.reveal(cur, col, true);
                  }}
                />
              ) : (
                <LinkHypForm
                  key={`h${bancada.ev.idx}`}
                  caso={caso}
                  ev={bancada.ev}
                  modo={modo}
                  rev={rev}
                  onMsg={onMsg}
                  onFechar={() => {
                    setBancada(null);
                    gridRef.current?.reveal(cur, col, true);
                  }}
                  onSalvo={(m) => {
                    setBancada(null);
                    onEscrito(m);
                    gridRef.current?.reveal(cur, col, true);
                  }}
                />
              )
            ) : null
          }
          onCopy={(label, value) => void copy(label, value)}
          onMark={() => detailEv && toggleMark(detailEv)}
          onPivot={(field, value) => onPivot(field, value, 'DETALHE')}
          onJumpRef={(r) => {
            const i = events.findIndex((e) => e.raw_ref === r);
            if (i < 0) onMsg(`${r} fora do filtro atual`, 'err');
            else {
              move(i);
              onMsg(`→ ${r}`, 'info');
            }
          }}
        />
      </div>
    </div>
  );
});
