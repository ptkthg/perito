// F3 ATT&CK (brief §4): colunas por tática na ordem da kill chain, células por técnica com
// contagem. Heurística = contorno tracejado com "?"; confirmada (citada em achados.md) = sólida.
// Nome em português no GUIADO. Enter/clique → F1 filtrada por `tecnica=T…` (filtro local).
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Resumo, TecnicaResumo } from '../../lib/types';
import type { Modo } from '../../lib/mode';
import type { ViewHandle } from '../../lib/view';
import { KILL_CHAIN, tecnicaPt } from '../../lib/attack-pt';
import { useConfirmadas } from '../../lib/conf';

interface Props {
  resumo: Resumo | null;
  modo: Modo;
  onTecnica(id: string): void;
}

export const AttackMatrix = forwardRef<ViewHandle, Props>(function AttackMatrix({ resumo, modo, onTecnica }, ref) {
  const guiado = modo === 'guiado';
  const conf = useConfirmadas();
  const [col, setCol] = useState(0);
  const [row, setRow] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const colunas = useMemo(() => {
    const por = new Map<string, TecnicaResumo[]>();
    for (const t of resumo?.tecnicas ?? []) (por.get(t.tatica) ?? por.set(t.tatica, []).get(t.tatica)!).push(t);
    const conhecidas = new Set(KILL_CHAIN.map((k) => k.tatica));
    const extras = [...por.keys()].filter((k) => !conhecidas.has(k));
    return [...KILL_CHAIN.map((k) => ({ tatica: k.tatica, rotulo: k.rotulo })), ...extras.map((e) => ({ tatica: e, rotulo: e.toUpperCase() }))].map((c) => ({
      ...c,
      tecs: (por.get(c.tatica) ?? []).sort((a, b) => b.eventos - a.eventos || a.id.localeCompare(b.id)),
    }));
  }, [resumo]);

  const foco = (c: number, r: number) =>
    requestAnimationFrame(() => (rootRef.current?.querySelector<HTMLElement>(`[data-mx="${c}:${r}"]`) ?? rootRef.current)?.focus());

  useImperativeHandle(ref, () => ({
    onKey(e) {
      const ncol = colunas.length;
      const linhas = (c: number) => colunas[c]?.tecs.length ?? 0;
      const ir = (c: number, r: number) => {
        setCol(c);
        setRow(r);
        foco(c, r);
      };
      switch (e.key) {
        case 'ArrowRight':
        case 'l':
        case 'ArrowLeft':
        case 'h': {
          const d = e.key === 'ArrowRight' || e.key === 'l' ? 1 : -1;
          let c = col + d;
          while (c >= 0 && c < ncol && linhas(c) === 0) c += d;
          if (c >= 0 && c < ncol) ir(c, Math.min(row, linhas(c) - 1));
          return true;
        }
        case 'ArrowDown':
        case 'j':
          ir(col, Math.min(linhas(col) - 1, row + 1));
          return true;
        case 'ArrowUp':
        case 'k':
          ir(col, Math.max(0, row - 1));
          return true;
        case 'Enter':
        case 'p': {
          const t = colunas[col]?.tecs[row];
          if (t) onTecnica(t.id);
          return true;
        }
        default:
          return false;
      }
    },
    focus() {
      const c = colunas.findIndex((x) => x.tecs.length > 0);
      if (c >= 0 && (colunas[col]?.tecs.length ?? 0) === 0) {
        setCol(c);
        setRow(0);
        foco(c, 0);
      } else foco(col, row);
    },
  }));

  const total = (resumo?.tecnicas ?? []).length;
  const confirmadas = (resumo?.tecnicas ?? []).filter((t) => conf.global.has(t.id)).length;

  return (
    <div className="mxv" ref={rootRef} tabIndex={-1}>
      <div className="doc-bar">
        <span className="lbl">F3 ATT&amp;CK</span> <span className="t3">▮</span> {total} técnicas ·{' '}
        <span className="green">{confirmadas} confirmadas</span> · <span className="amber">{total - confirmadas} sugeridas (?)</span>
        <span className="t3"> · ←→↑↓ navega · Enter abre a timeline filtrada</span>
        {guiado && (
          <span className="t2"> · contorno tracejado = sugerida por regra automática; sólido = confirmada em achados.md</span>
        )}
      </div>
      {!resumo && <p className="inline-state t3">CARREGANDO /resumo ...</p>}
      <div className="mx" role="grid" aria-label="Matriz ATT&CK por tática" style={{ gridTemplateColumns: `repeat(${colunas.length}, minmax(0, 1fr))` }}>
        {colunas.map((c, ci) => (
          <div key={c.tatica} className="mx-col" role="row">
            <div className="mx-h" role="columnheader">
              <span className={`lbl${c.tecs.length ? ' amber' : ' t3'}`}>{c.rotulo}</span>
              <span className="t3">{guiado ? c.tatica : ''}</span>
            </div>
            {c.tecs.length === 0 && <div className="mx-vazio t3">—</div>}
            {c.tecs.map((t, ri) => {
              const ok = conf.global.has(t.id);
              const sel = ci === col && ri === row;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="gridcell"
                  data-mx={`${ci}:${ri}`}
                  tabIndex={sel ? 0 : -1}
                  className={`mx-cel ${ok ? 'is-conf' : 'is-heur'}${sel ? ' is-sel' : ''}`}
                  onClick={() => {
                    setCol(ci);
                    setRow(ri);
                    onTecnica(t.id);
                  }}
                  title={`${t.id} ${t.nome} — ${t.eventos} evento(s)${ok ? ' · confirmada em achados.md' : ' · sugerida (heurística)'}`}
                >
                  <span className="mx-n num-data">{t.eventos}</span>
                  <span className="num-data">
                    {t.id}
                    {!ok && <span className="amber">?</span>}
                  </span>
                  <br />
                  <span className="t2">{guiado ? tecnicaPt(t.id, t.nome) : t.nome}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
