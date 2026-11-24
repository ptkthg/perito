// Tela de seleção de casos (GET /api/casos) no estilo console: j/k, Enter.
import { useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api';
import type { CasoItem } from '../lib/types';
import { navigate } from '../lib/route';
import { shortPhase } from '../lib/format';

export function CaseSelect() {
  const [casos, setCasos] = useState<CasoItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cur, setCur] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    api
      .casos()
      .then((c) => vivo && setCasos(c))
      .catch((e: unknown) => vivo && setErro(describeError(e)));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${cur}"]`);
    el?.focus();
  }, [cur, casos]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!casos?.length) return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      setCur((c) => Math.min(casos.length - 1, c + 1));
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      setCur((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = casos[cur];
      if (c) navigate(c.id);
    }
  };

  return (
    <div className="sel">
      <header className="status" role="banner">
        <span className="status-id">PERITO</span>
        <span className="sep">▮</span>
        <span className="lbl">SELEÇÃO DE CASO</span>
        <span className="sep">▮</span>
        <span className="lbl">{casos ? `${casos.length} CASOS` : '— CASOS'}</span>
        <span className="sep">▮</span>
        <span className="lbl">{api.modo === 'fixtures' ? 'FIXTURES' : 'API LOCAL'}</span>
        <span className="sep">▮</span>
        <span className="lbl">UTC</span>
      </header>
      <main className="sel-main">
        {erro && (
          <p className="inline-state red" role="alert">
            ERRO {erro}
          </p>
        )}
        {!erro && !casos && <p className="inline-state t2">CARREGANDO /api/casos ...</p>}
        {casos && casos.length === 0 && <p className="inline-state t2">0 CASOS — rode `perito novo` e `perito build`</p>}
        {casos && casos.length > 0 && (
          <div className="sel-table" role="grid" aria-label="Casos" aria-rowcount={casos.length + 1} onKeyDown={onKey} ref={listRef}>
            <div className="sel-row sel-head" role="row" aria-rowindex={1}>
              <span className="lbl" role="columnheader">ID</span>
              <span className="lbl" role="columnheader">TÍTULO</span>
              <span className="lbl" role="columnheader">FASE</span>
              <span className="lbl num" role="columnheader">EVID</span>
              <span className="lbl num" role="columnheader">EVT</span>
            </div>
            {casos.map((c, i) => (
              <div
                key={c.id}
                className={`sel-row${i === cur ? ' is-sel' : ''}`}
                role="row"
                aria-rowindex={i + 2}
                aria-selected={i === cur}
                data-i={i}
                tabIndex={i === cur ? 0 : -1}
                onClick={() => setCur(i)}
                onDoubleClick={() => navigate(c.id)}
              >
                <span role="gridcell" className="sel-id">
                  <span className="selbar" aria-hidden>
                    {i === cur ? '▌' : ' '}
                  </span>
                  <a href={`#/caso/${encodeURIComponent(c.id)}/timeline`} className="cyan" tabIndex={-1}>
                    {c.id}
                  </a>
                </span>
                <span role="gridcell" className="ellip">
                  {c.titulo}
                </span>
                <span role="gridcell" title={c.fase}>
                  <span className="phase">{shortPhase(c.fase)}</span> <span className="t2">{c.fase}</span>
                </span>
                <span role="gridcell" className="num">
                  {c.evidencias}
                </span>
                <span role="gridcell" className="num">
                  {c.eventos}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
      <footer className="sel-foot t3">j/k move · ↵ abre o caso · URL direta: #/caso/&lt;ID&gt;/timeline</footer>
    </div>
  );
}
