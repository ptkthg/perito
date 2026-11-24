// Console do caso: barra de status, abas F1…F9, visão ativa, linha de comando, ajuda.
// Dono do estado de filtro (com pilha de desfazer) e do teclado global.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, describeError, rebucket } from '../lib/api';
import type { Entidades, EventosResp, Histograma, Resumo, Visao } from '../lib/types';
import {
  type Clause,
  type FilterField,
  type FilterState,
  EMPTY_FILTER,
  addClause,
  applyLocal,
  compileQuery,
  describeClause,
  describeFilter,
  hasLocalClauses,
  removeClause,
  toQuery,
} from '../lib/filters';
import { makeTacticOf } from '../lib/attack-pt';
import type { Modo } from '../lib/mode';
import { Overview } from '../views/overview/Overview';
import { Entities } from '../views/entities/Entities';
import { HypAch } from '../views/hyp/HypAch';
import { Ioc } from '../views/ioc/Ioc';
import { ErrorBoundary } from './ErrorBoundary';
import type { ViewHandle } from '../lib/view';
import { resolveRefs } from '../lib/refs';
import type { Achado, PeritoEvent } from '../lib/types';
import { parseCommand } from '../lib/commands';
import { navigate, visaoPorTecla } from '../lib/route';
import { DENSIDADES, type Densidade, loadDensidade, loadTema, saveDensidade, saveTema } from '../lib/prefs';
import { StatusBar } from './StatusBar';
import { useEffectiveRowHeight } from '../lib/hooks';
import { Tabs } from './Tabs';
import { CommandLine, type CommandLineHandle, type PromptMode } from './CommandLine';
import { HelpOverlay } from './HelpOverlay';
import { PendingView } from './PendingView';
import { Timeline, type MsgKind, type TimelineHandle } from '../views/timeline/Timeline';

interface Props {
  caso: string;
  visao: Visao;
  modo: Modo;
  onModo(m: Modo): void;
}

interface Msg {
  text: string;
  kind: MsgKind;
  n: number;
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export function CaseShell({ caso, visao, modo, onModo }: Props) {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [entidades, setEntidades] = useState<Entidades | null>(null);
  const [baseErr, setBaseErr] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [undo, setUndo] = useState<FilterState[]>([]);

  const [resp, setResp] = useState<EventosResp | null>(null);
  const [evLoading, setEvLoading] = useState(true);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [hist, setHist] = useState<Histograma | null>(null);

  const [msg, setMsg] = useState<Msg>({ text: '', kind: 'info', n: 0 });
  const [help, setHelp] = useState(false);
  const [dens, setDens] = useState<Densidade>(loadDensidade);
  const [tema, setTema] = useState(loadTema);

  const tlRef = useRef<TimelineHandle>(null);
  const viewRef = useRef<ViewHandle>(null);
  /** Handle da visão ativa (timeline fica sempre montada; as outras, uma por vez). */
  const active = useCallback((): ViewHandle | null => (visao === 'timeline' ? tlRef.current : viewRef.current), [visao]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const cmdRef = useRef<CommandLineHandle>(null);

  const say = useCallback((text: string, kind: MsgKind = 'info') => setMsg((m) => ({ text, kind, n: m.n + 1 })), []);

  // ---------- dados de base ----------
  useEffect(() => {
    let vivo = true;
    api
      .resumo(caso)
      .then((r) => vivo && setResumo(r))
      .catch((e: unknown) => {
        if (!vivo) return;
        setBaseErr(describeError(e));
        say(`ERRO ${describeError(e)}`, 'err');
      });
    api
      .entidades(caso)
      .then((r) => vivo && setEntidades(r))
      .catch((e: unknown) => vivo && say(`ERRO entidades: ${describeError(e)} (autocompletar sem valores)`, 'err'));
    return () => {
      vivo = false;
    };
  }, [caso, say]);

  // ---------- eventos + histograma a cada mudança de filtro ----------
  const seq = useRef(0);
  const local = hasLocalClauses(filter);
  const tecnicasKey = local ? JSON.stringify(resumo?.tecnicas ?? null) : '';
  useEffect(() => {
    const my = ++seq.current;
    setEvLoading(true);
    const t0 = performance.now();
    if (local) {
      // Filtro local (tatica): busca sem janela, aplica a tática no cliente, recalcula o
      // histograma a partir desses eventos e só então aplica a janela para a tabela.
      if (!resumo) return;
      const tacticOf = makeTacticOf(resumo.tecnicas);
      const qs = toQuery(filter, { semJanela: true });
      Promise.all([api.eventos(caso, qs), api.histograma(caso, qs)])
        .then(([r, h]) => {
          if (my !== seq.current) return;
          const all = applyLocal(r.eventos, filter, tacticOf);
          const win = compileQuery({ de: filter.de ?? undefined, ate: filter.ate ?? undefined });
          const eventos = filter.de || filter.ate ? all.filter(win) : all;
          setResp({ total: r.total, filtrados: eventos.length, eventos });
          setHist(rebucket(h, all));
          setEvErr(null);
          setEvLoading(false);
        })
        .catch((e: unknown) => {
          if (my !== seq.current) return;
          setEvErr(describeError(e));
          setResp({ total: 0, filtrados: 0, eventos: [] });
          setEvLoading(false);
          say(`ERRO ${describeError(e)}`, 'err');
        });
      return;
    }
    const q = toQuery(filter);
    api
      .eventos(caso, q)
      .then((r) => {
        if (my !== seq.current) return;
        setResp(r);
        setEvErr(null);
        setEvLoading(false);
        if (import.meta.env.DEV) console.debug(`eventos ${r.filtrados}/${r.total} em ${(performance.now() - t0).toFixed(0)} ms`);
      })
      .catch((e: unknown) => {
        if (my !== seq.current) return;
        setEvErr(describeError(e));
        setResp({ total: resp?.total ?? 0, filtrados: 0, eventos: [] });
        setEvLoading(false);
        say(`ERRO ${describeError(e)}`, 'err');
      });
    // O sismógrafo ignora a janela (de/ate) para mostrar o contexto; a janela vira faixa.
    api
      .histograma(caso, toQuery(filter, { semJanela: true }))
      .then((h) => my === seq.current && setHist(h))
      .catch((e: unknown) => my === seq.current && say(`ERRO histograma: ${describeError(e)}`, 'err'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caso, filter, local ? tecnicasKey : '', local && !!resumo]);

  // ---------- filtros com desfazer ----------
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const undoRef = useRef(undo);
  undoRef.current = undo;

  const applyFilter = useCallback(
    (next: FilterState, text: string) => {
      setUndo((u) => [...u.slice(-99), filterRef.current]);
      setFilter(next);
      say(text, 'ok');
    },
    [say],
  );

  const doUndo = useCallback(() => {
    const u = undoRef.current;
    const prev = u[u.length - 1];
    if (!prev) {
      say('nada para desfazer', 'info');
      return;
    }
    setUndo(u.slice(0, -1));
    setFilter(prev);
    say(`desfeito → ${describeFilter(prev) || 'sem filtros'}`, 'ok');
  }, [say]);

  const onPivot = useCallback(
    (field: FilterField, value: string, via: string) => {
      applyFilter({ clauses: [{ field, neg: false, value }], de: null, ate: null }, `pivô ${field}=${value} (${via}) · u desfaz`);
    },
    [applyFilter],
  );

  const onClause = useCallback(
    (c: Clause, via: string) => {
      try {
        const next = addClause(filterRef.current, c);
        applyFilter(next, `filtro ${describeClause(c)} (${via}) · u desfaz`);
      } catch (e) {
        say(e instanceof Error ? e.message : String(e), 'err');
      }
    },
    [applyFilter, say],
  );

  const onRemoveClause = useCallback(
    (i: number) => {
      const c = filterRef.current.clauses[i];
      applyFilter(removeClause(filterRef.current, i), `removido ${c ? describeClause(c) : ''} · u desfaz`);
    },
    [applyFilter],
  );

  const onWindow = useCallback(
    (de: string | null, ate: string | null) => {
      applyFilter({ ...filterRef.current, de, ate }, de || ate ? `janela ${de ?? '…'} .. ${ate ?? '…'} · u desfaz` : 'janela removida · u desfaz');
    },
    [applyFilter],
  );

  // ---------- comandos ----------
  const baseDay = (resumo?.janela.primeiro ?? hist?.inicio ?? new Date().toISOString()).slice(0, 10);

  const execute = useCallback(
    (text: string): boolean => {
      let cmd;
      try {
        cmd = parseCommand(text, { baseDay });
      } catch (e) {
        say(`✕ ${e instanceof Error ? e.message : String(e)}`, 'err');
        return false;
      }
      switch (cmd.kind) {
        case 'filtro': {
          try {
            let next = filterRef.current;
            for (const c of cmd.clauses) next = addClause(next, c);
            applyFilter(next, `filtro ${cmd.clauses.map(describeClause).join(' ∧ ')} · u desfaz`);
          } catch (e) {
            say(`✕ ${e instanceof Error ? e.message : String(e)}`, 'err');
            return false;
          }
          break;
        }
        case 'pivo':
          onPivot(cmd.field, cmd.value, 'comando');
          break;
        case 'janela':
          onWindow(cmd.de, cmd.ate);
          break;
        case 'ir':
          if (visao !== 'timeline') navigate(caso, 'timeline');
          requestAnimationFrame(() => {
            const r = tlRef.current?.goTo(cmd.ts);
            if (r) say(r, 'ok');
          });
          break;
        case 'limpar':
          applyFilter(EMPTY_FILTER, 'filtros limpos · u desfaz');
          break;
        case 'desfazer':
          doUndo();
          break;
        case 'ajuda':
          setHelp(true);
          break;
      }
      return true;
    },
    [baseDay, say, applyFilter, onPivot, onWindow, doUndo, visao, caso],
  );

  const focusView = useCallback(() => {
    const h = activeRef.current();
    if (h?.focus) h.focus();
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);

  // ---------- refs de evidência → eventos na F1 ----------
  const allRef = useRef<Promise<PeritoEvent[]> | null>(null);
  const ensureAll = useCallback(() => (allRef.current ??= api.eventos(caso, {}).then((r) => r.eventos)), [caso]);
  const respRef = useRef(resp);
  respRef.current = resp;
  const pendingFocus = useRef<{ idxs: number[]; rotulo: string } | null>(null);

  const focusLater = useCallback(
    (idxs: number[], rotulo: string) => {
      window.setTimeout(() => {
        const n = tlRef.current?.focusEvents(idxs, rotulo) ?? 0;
        if (n) say(`${rotulo}: ${n} evento(s) destacado(s) · n/N percorre · Esc limpa`, 'ok');
        else say(`${rotulo}: eventos fora do filtro atual`, 'err');
      }, 60);
    },
    [say],
  );

  const openEvents = useCallback(
    (idxs: number[], rotulo: string) => {
      navigate(caso, 'timeline');
      const atuais = new Set((respRef.current?.eventos ?? []).map((e) => e.idx));
      if (idxs.every((i) => atuais.has(i))) {
        focusLater(idxs, rotulo);
        return;
      }
      pendingFocus.current = { idxs, rotulo };
      applyFilter(EMPTY_FILTER, `filtros limpos para mostrar ${rotulo} · u desfaz`);
    },
    [caso, focusLater, applyFilter],
  );

  useEffect(() => {
    const p = pendingFocus.current;
    if (!p || !resp || evLoading) return;
    pendingFocus.current = null;
    focusLater(p.idxs, p.rotulo);
  }, [resp, evLoading, focusLater]);

  const openRefs = useCallback(
    (texto: string, achados: Achado[], rotulo: string) => {
      ensureAll()
        .then((evs) => {
          const idxs = resolveRefs(texto, evs, achados);
          if (idxs.length === 0) say(`${rotulo}: nenhum evento da timeline corresponde a "${texto}"`, 'err');
          else openEvents(idxs, rotulo);
        })
        .catch((e: unknown) => say(`ERRO ${describeError(e)}`, 'err'));
    },
    [ensureAll, openEvents, say],
  );

  const pivotAndGo = useCallback(
    (field: FilterField, value: string, via: string) => {
      onPivot(field, value, via);
      navigate(caso, 'timeline');
    },
    [onPivot, caso],
  );

  const onPrompt = useCallback((prefill: string, mode: PromptMode) => cmdRef.current?.focus(prefill, mode), []);

  // ---------- densidade e tema ----------
  const rowH = useEffectiveRowHeight(dens);
  useEffect(() => saveDensidade(dens), [dens]);

  useEffect(() => {
    const claro = tema === 'claro' || visao === 'relatorios';
    if (claro) document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    saveTema(tema);
  }, [tema, visao]);

  // ---------- teclado global ----------
  const gPending = useRef<number | null>(null);
  const stateRef = useRef({ visao, help, execute, doUndo, focusView, dens, tema, modo, onModo });
  stateRef.current = { visao, help, execute, doUndo, focusView, dens, tema, modo, onModo };

  useEffect(() => {
    const clearG = () => {
      if (gPending.current) window.clearTimeout(gPending.current);
      gPending.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      // F1–F9 sempre (inclusive no prompt).
      const fm = /^F([1-9])$/.exec(e.key);
      if (fm && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const v = visaoPorTecla(fm[1]!);
        if (v) {
          setHelp(false);
          navigate(caso, v);
        }
        return;
      }
      if (e.ctrlKey && !e.altKey && (e.key === '=' || e.key === '+' || e.key === '-')) {
        e.preventDefault();
        const i = DENSIDADES.indexOf(s.dens);
        const n = DENSIDADES[Math.max(0, Math.min(DENSIDADES.length - 1, i + (e.key === '-' ? -1 : 1)))]!;
        setDens(n);
        say(`densidade ${n}px`, 'info');
        return;
      }
      if (s.help) return; // a ajuda trata as próprias teclas
      if (isTyping(e.target)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // Enter/Espaço em botões e links seguem o comportamento nativo.
      const t = e.target as HTMLElement | null;
      if ((e.key === 'Enter' || e.key === ' ') && t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return;

      // Prefixo g: gg (início) e g1…g9 (visões).
      if (gPending.current) {
        clearG();
        if (e.key === 'g') {
          e.preventDefault();
          if (s.visao === 'timeline') tlRef.current?.top();
          return;
        }
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          const v = visaoPorTecla(e.key);
          if (v) navigate(caso, v);
          return;
        }
      } else if (e.key === 'g') {
        e.preventDefault();
        gPending.current = window.setTimeout(clearG, 1200);
        return;
      }

      switch (e.key) {
        case '?':
          e.preventDefault();
          setHelp(true);
          return;
        case '>':
        case ':':
          e.preventDefault();
          cmdRef.current?.focus();
          return;
        case 'L':
          if (e.shiftKey) {
            e.preventDefault();
            const n = s.tema === 'claro' ? 'escuro' : 'claro';
            setTema(n);
            say(`modo ${n}`, 'info');
            return;
          }
          break;
        case 'u':
          e.preventDefault();
          s.doUndo();
          return;
        case 'M': {
          e.preventDefault();
          const n = s.modo === 'guiado' ? 'analista' : 'guiado';
          s.onModo(n);
          say(`modo ${n.toUpperCase()}`, 'info');
          return;
        }
        case 'Escape':
          e.preventDefault();
          if (activeRef.current()?.escape?.()) return;
          (document.activeElement as HTMLElement | null)?.blur?.();
          return;
      }
      if (activeRef.current()?.onKey?.(e)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearG();
    };
  }, [caso, say]);

  const suggestCtx = useMemo(() => ({ entidades, resumo }), [entidades, resumo]);

  return (
    <div className="app">
      <StatusBar
        caso={caso}
        resumo={resumo}
        filtrados={resp?.filtrados ?? null}
        total={resp?.total ?? null}
        modo={modo}
        onModo={() => {
          const n = modo === 'guiado' ? 'analista' : 'guiado';
          onModo(n);
          say(`modo ${n.toUpperCase()}`, 'info');
        }}
        onHelp={() => setHelp(true)}
      />
      <Tabs caso={caso} visao={visao} />
      <main className="view" aria-label="Visão ativa">
        {baseErr && !resumo && (
          <p className="inline-state red" role="alert">
            ERRO resumo: {baseErr}
          </p>
        )}
        <div className="view-slot" hidden={visao !== 'timeline'}>
          <ErrorBoundary label="TIMELINE" chave="timeline">
          <Timeline
            ref={tlRef}
            caso={caso}
            resp={resp}
            loading={evLoading}
            error={evErr}
            hist={hist}
            resumo={resumo}
            filter={filter}
            rowH={rowH}
            onPivot={onPivot}
            onClause={onClause}
            onRemoveClause={onRemoveClause}
            onClearWindow={() => onWindow(null, null)}
            onWindow={onWindow}
            onMsg={say}
            onPrompt={onPrompt}
            modo={modo}
            onOverview={() => navigate(caso, 'visao')}
          />
          </ErrorBoundary>
        </div>
        {visao === 'visao' && (
          <div className="view-slot view-scroll">
            <ErrorBoundary label="VISÃO GERAL" chave="visao">
            <Overview
              caso={caso}
              resumo={resumo}
              entidades={entidades}
              onPivot={(field, value) => {
                onPivot(field, value, 'VISÃO GERAL');
                navigate(caso, 'timeline');
              }}
              onTatica={(tatica) => {
                applyFilter({ clauses: [{ field: 'tatica', neg: false, value: tatica }], de: null, ate: null }, `filtro tatica (${tatica}) · u desfaz`);
                navigate(caso, 'timeline');
              }}
              onCobertura={() => navigate(caso, 'cobertura')}
            />
            </ErrorBoundary>
          </div>
        )}
        {visao === 'entidades' && (
          <div className="view-slot">
            <ErrorBoundary label="ENTIDADES" chave="entidades">
              <Entities
                ref={viewRef}
                caso={caso}
                entidades={entidades}
                resumo={resumo}
                modo={modo}
                onPivot={(f, v) => pivotAndGo(f, v, 'ENTIDADES')}
                onFilter={(f, v) => {
                  onClause({ field: f, neg: false, value: v }, 'ENTIDADES');
                  navigate(caso, 'timeline');
                }}
                onMsg={say}
                onPrompt={onPrompt}
              />
            </ErrorBoundary>
          </div>
        )}
        {visao === 'hipoteses' && (
          <div className="view-slot view-scroll">
            <ErrorBoundary label="HIP/ACH" chave="hipoteses">
              <HypAch ref={viewRef} caso={caso} modo={modo} onOpenRefs={openRefs} onMsg={say} onPrompt={onPrompt} />
            </ErrorBoundary>
          </div>
        )}
        {visao === 'ioc' && (
          <div className="view-slot view-scroll">
            <ErrorBoundary label="IOC" chave="ioc">
              <Ioc ref={viewRef} caso={caso} modo={modo} onPivot={(f, v) => pivotAndGo(f, v, 'IOC')} onMsg={say} onPrompt={onPrompt} />
            </ErrorBoundary>
          </div>
        )}
        {!['timeline', 'visao', 'entidades', 'hipoteses', 'ioc'].includes(visao) && <PendingView visao={visao} />}
      </main>
      <footer className="bottom">
        <div className={`msg msg-${msg.kind}`} role="status" aria-live="polite" aria-atomic="true">
          {msg.text ? msg.text : <span className="t3">pronto · {api.modo === 'fixtures' ? 'modo FIXTURES' : 'API local'} · densidade {dens} ({rowH}px)</span>}
        </div>
        <CommandLine
          ref={cmdRef}
          ctx={suggestCtx}
          onExecute={execute}
          onSearch={(t) => activeRef.current()?.search?.(t)}
          onSearchCommit={(t) => activeRef.current()?.searchCommit?.(t)}
          onSearchCancel={() => activeRef.current()?.searchCancel?.()}
          onLeave={focusView}
        />
      </footer>
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </div>
  );
}
