// F2 ENTIDADES / PIVÔ: uma coluna por tipo (máquinas, contas, IPs, domínios, hashes).
// Cada item: valor, nº de eventos, fontes, mini-sparkline no tempo, 1ª/última vez e selos.
// Enter/clique abre a F1 com o pivô. Relação textual da entidade selecionada no rodapé.
// Teclas: j/k item · h/l coluna · Enter/p pivô · f filtro · y copia · / filtra a lista.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { Entidades, EntityInfo, Resumo } from '../../lib/types';
import type { FilterField } from '../../lib/filters';
import { type EKind, binsByEntity, caminho, coocorrencias, isExterno, sparkline } from '../../lib/entities';
import { hhmm, shortHash, sourceCode, sourceColor, tsMs } from '../../lib/format';
import { type Modo } from '../../lib/mode';
import { type ViewHandle, moveKey } from '../../lib/view';
import { useLoad } from '../../lib/useLoad';
import { copyText } from '../../lib/clipboard';
import type { PromptMode } from '../../components/CommandLine';
import type { MsgKind } from '../timeline/Timeline';

interface Props {
  caso: string;
  entidades: Entidades | null;
  resumo: Resumo | null;
  modo: Modo;
  onPivot(field: FilterField, value: string): void;
  onFilter(field: FilterField, value: string): void;
  onMsg(text: string, kind?: MsgKind): void;
  onPrompt(prefill: string, mode: PromptMode): void;
}

const COLUNAS: { kind: EKind; field: FilterField; guiado: string; analista: string; explica: string }[] = [
  { kind: 'host', field: 'host', guiado: 'MÁQUINAS', analista: 'HOST', explica: 'computadores e servidores que aparecem nos registros' },
  { kind: 'user', field: 'user', guiado: 'CONTAS', analista: 'USER', explica: 'usuários e contas de serviço' },
  { kind: 'ip', field: 'ip', guiado: 'IPs', analista: 'IP', explica: 'endereços de rede; "externo" = fora da rede interna' },
  { kind: 'domain', field: 'dominio', guiado: 'DOMÍNIOS', analista: 'DOMÍNIO', explica: 'nomes de sites e servidores consultados' },
  { kind: 'sha256', field: 'hash', guiado: 'HASHES', analista: 'SHA256', explica: 'impressão digital (SHA-256) de arquivos' },
];

interface Item {
  v: string;
  info: EntityInfo;
}

export const Entities = forwardRef<ViewHandle, Props>(function Entities(props, ref) {
  const { caso, entidades, resumo, modo, onPivot, onFilter, onMsg, onPrompt } = props;
  const guiado = modo === 'guiado';
  const evs = useLoad(() => api.eventos(caso, {}), [caso]);
  const events = useMemo(() => (evs?.ok ? evs.v.eventos : []), [evs]);
  const [col, setCol] = useState(0);
  const [rows, setRows] = useState<number[]>([0, 0, 0, 0, 0]);
  const [busca, setBusca] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const semEdr = useMemo(() => new Set(resumo?.hosts_sem_edr ?? []), [resumo]);

  const listas = useMemo(() => {
    const t = busca.toLowerCase();
    return COLUNAS.map((c) =>
      Object.entries(entidades?.[c.kind] ?? {})
        .map(([v, info]): Item => ({ v, info }))
        .filter((it) => !t || it.v.toLowerCase().includes(t))
        .sort((a, b) => b.info.eventos - a.info.eventos || a.v.localeCompare(b.v)),
    );
  }, [entidades, busca]);

  const bins = useMemo(() => {
    const j = resumo?.janela;
    if (!j?.primeiro || !j.ultimo || events.length === 0) return null;
    return binsByEntity(events, j.primeiro, j.ultimo, 20);
  }, [events, resumo]);

  const sel = listas[col]?.[rows[col] ?? 0] ?? null;
  const selKind = COLUNAS[col]!.kind;

  /** Foca o item (c, r); se não existir (lista vazia após "/"), foca a raiz — nunca deixa o foco preso no prompt. */
  const focusSel = (c: number, r: number) => {
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-ent="${c}:${r}"]`);
      (el ?? rootRef.current)?.focus({ preventScroll: false });
    });
  };

  const setPos = (c: number, r: number, focus = true) => {
    setCol(c);
    setRows((rs) => rs.map((x, i) => (i === c ? r : x)));
    if (focus) focusSel(c, r);
  };

  // Ao filtrar, volta ao topo das listas.
  useEffect(() => setRows([0, 0, 0, 0, 0]), [busca]);

  useImperativeHandle(ref, () => ({
    onKey(e) {
      let mv = moveKey(e.key, col, rows[col] ?? 0, COLUNAS.length, (c) => listas[c]?.length ?? 0);
      // h/l pulam colunas vazias (ex.: depois de filtrar com /).
      if (mv && (e.key === 'h' || e.key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const d = e.key === 'h' || e.key === 'ArrowLeft' ? -1 : 1;
        let c = mv.col;
        while ((listas[c]?.length ?? 0) === 0 && c + d >= 0 && c + d < COLUNAS.length) c += d;
        mv = (listas[c]?.length ?? 0) > 0 ? { col: c, row: Math.min(rows[c] ?? 0, (listas[c]?.length ?? 1) - 1) } : { col, row: rows[col] ?? 0 };
      }
      if (mv) {
        setPos(mv.col, mv.row);
        return true;
      }
      const c = COLUNAS[col]!;
      switch (e.key) {
        case 'Enter':
        case 'p':
          if (sel) onPivot(c.field, sel.v);
          return true;
        case 'f':
          if (sel) onFilter(c.field, sel.v);
          return true;
        case 'y':
          if (sel) void copyText(sel.v).then((ok) => onMsg(ok ? `copiado: ${sel.v}` : 'falha ao copiar', ok ? 'ok' : 'err'));
          return true;
        case '/':
          onPrompt('', 'search');
          return true;
        default:
          return false;
      }
    },
    search(t) {
      setBusca(t);
    },
    searchCommit(t) {
      setBusca(t);
      if (t) onMsg(`entidades contendo "${t}" · Esc limpa`, 'info');
    },
    searchCancel() {
      setBusca('');
    },
    escape() {
      if (busca) {
        setBusca('');
        onMsg('filtro da lista limpo', 'info');
        return true;
      }
      return false;
    },
    focus() {
      // Coluna atual vazia (ex.: depois de filtrar com /)? vai para a primeira com itens.
      const c = (listas[col]?.length ?? 0) > 0 ? col : Math.max(0, listas.findIndex((l) => l.length > 0));
      setPos(c, Math.min(rows[c] ?? 0, Math.max(0, (listas[c]?.length ?? 1) - 1)));
    },
  }));

  const rel = useMemo(() => {
    if (!sel || events.length === 0) return null;
    return { path: caminho(events, selKind, sel.v), co: coocorrencias(events, selKind, sel.v) };
  }, [sel, selKind, events]);

  const show = (kind: EKind, v: string) => (kind === 'sha256' ? shortHash(v) : v);

  return (
    <div className="ent" ref={rootRef} tabIndex={-1}>
      {busca && (
        <div className="strip">
          <span className="lbl t2">BUSCA</span> <span className="amber">/{busca}</span>
          <span className="t3"> · Esc limpa</span>
        </div>
      )}
      <div className="ent-cols">
        {COLUNAS.map((c, ci) => {
          const lista = listas[ci] ?? [];
          return (
            <section key={c.kind} className={`ent-col${ci === col ? ' is-col' : ''}`} aria-labelledby={`ent-h-${c.kind}`}>
              <header className="ent-head">
                <h2 id={`ent-h-${c.kind}`} className="lbl">
                  {guiado ? c.guiado : c.analista} <span className="t3 num-data">{lista.length}</span>
                </h2>
                {guiado && <p className="ent-explica t2">{c.explica}</p>}
              </header>
              <ul className="ent-list" role="listbox" aria-label={c.guiado}>
                {lista.length === 0 && <li className="t3 ent-vazio">{entidades ? 'nenhuma' : 'CARREGANDO ...'}</li>}
                {lista.map((it, ri) => {
                  const isSel = ci === col && ri === (rows[ci] ?? 0);
                  const b = bins?.get(`${c.kind}\u0000${it.v}`);
                  return (
                    <li
                      key={it.v}
                      role="option"
                      aria-selected={isSel}
                      tabIndex={isSel ? 0 : -1}
                      data-ent={`${ci}:${ri}`}
                      className={`ent-item${isSel ? ' is-sel' : ''}`}
                      onClick={() => setPos(ci, ri, false)}
                      onDoubleClick={() => onPivot(c.field, it.v)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
                          onPivot(c.field, it.v);
                        }
                      }}
                      title={`${it.v} · Enter ou duplo clique abre a timeline com este pivô`}
                    >
                      <span className="ent-l1">
                        <span className="selbar" aria-hidden>
                          {isSel ? '▌' : ' '}
                        </span>
                        <button
                          type="button"
                          className="pivot ent-v"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPivot(c.field, it.v);
                          }}
                        >
                          {show(c.kind, it.v)}
                        </button>
                        {c.kind === 'host' && semEdr.has(it.v) && <span className="stamp stamp-bad">sem EDR</span>}
                        {isExterno(c.kind, it.v) && <span className="stamp stamp-ext">externo</span>}
                        <span className="ent-n num-data">{it.info.eventos}</span>
                      </span>
                      <span className="ent-l2">
                        <span className="spark" aria-label="distribuição no tempo">
                          {b ? sparkline(b) : '·'.repeat(20)}
                        </span>
                        <span className="ent-src">
                          {it.info.fontes.map((f) => (
                            <span key={f} style={{ color: sourceColor(f) }} title={f}>
                              {sourceCode(f)}
                            </span>
                          ))}
                        </span>
                        <span className="t3 ent-t">
                          {hhmm(tsMs(it.info.primeira))}–{hhmm(tsMs(it.info.ultima))}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <footer className="ent-rel" aria-live="polite">
        {!sel && <span className="t3">selecione uma entidade (j/k, h/l) para ver as relações</span>}
        {sel && (
          <>
            <div className="ent-rel-line">
              <span className="lbl t2">{guiado ? 'CAMINHO' : 'RELAÇÃO'}</span>{' '}
              {!rel && <span className="t3">CARREGANDO eventos ...</span>}
              {rel &&
                rel.path.map((p, i) => (
                  <span key={p + i}>
                    {i > 0 && <span className="amber"> → </span>}
                    <span className={p === sel.v ? 'amber' : ''}>{p}</span>
                  </span>
                ))}
              <span className="t3">
                {' '}
                · 1ª {sel.info.primeira.slice(11, 19)} · última {sel.info.ultima.slice(11, 19)} · {sel.info.eventos} eventos
              </span>
            </div>
            {rel && (
              <div className="ent-rel-co">
                {COLUNAS.filter((c) => (rel.co[c.kind] ?? []).length > 0).map((c) => (
                  <span key={c.kind} className="ent-rel-group">
                    <span className="lbl t2">{guiado ? c.guiado : c.analista}</span>{' '}
                    {rel.co[c.kind].slice(0, 6).map((x) => (
                      <button key={x.valor} type="button" className="pivot ent-co" onClick={() => onPivot(c.field, x.valor)} title={`pivô ${c.field}=${x.valor}`}>
                        {show(c.kind, x.valor)}
                        <span className="t3">({x.n})</span>
                      </button>
                    ))}
                    {rel.co[c.kind].length > 6 && <span className="t3">+{rel.co[c.kind].length - 6}</span>}
                  </span>
                ))}
              </div>
            )}
            <div className="t3 ent-rel-hint">↵ pivô na timeline · f adiciona ao filtro · y copia · / filtra as listas</div>
          </>
        )}
      </footer>
    </div>
  );
});
