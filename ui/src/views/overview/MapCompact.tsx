// Versão compacta do MAPA na Visão Geral (brief §9.8): só os nós do caminho, sem caixas,
// com a linha de cabeçalho "MAPA DO ATAQUE · n passos · n máquina sem EDR · X saíram [gm] abrir mapa".
// Clicar num passo abre o MAPA com o passo em foco.
import { useMemo } from 'react';
import { api } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';
import { COLUNAS, bytesSI } from '../../lib/graph';
import type { Modo } from '../../lib/mode';

interface Props {
  caso: string;
  rev: number;
  modo: Modo;
  onAbrir(passo: number | null): void;
}

const GLIFO: Record<string, string> = { host: '┌', conta: '╔', app: '┏', email: '╎', ip: '›', dominio: '›' };

export function MapCompact({ caso, rev, modo, onAbrir }: Props) {
  const g = useLoad(() => api.grafo(caso), [caso, rev]);
  const dados = useMemo(() => {
    if (!g?.ok) return null;
    const ordem = new Map(g.v.caminho.map((id, i) => [id, i + 1]));
    const passos = g.v.arestas.filter((a) => ordem.has(a.id)).sort((a, b) => ordem.get(a.id)! - ordem.get(b.id)!);
    const ids = new Set(passos.flatMap((a) => [a.origem, a.destino]));
    const nos = g.v.nos.filter((n) => ids.has(n.id));
    const semEdr = nos.filter((n) => n.flags.sem_edr).length;
    const bytes = passos.filter((a) => a.volume_alto).reduce((s, a) => s + a.bytes_out, 0);
    const rot = new Map(g.v.nos.map((n) => [n.id, n.rotulo]));
    return { passos, nos, semEdr, bytes, ordem, rot };
  }, [g]);

  if (!g) return <p className="t3">CARREGANDO /grafo ...</p>;
  if (!g.ok) return <p className="red">ERRO {g.err}</p>;
  if (!dados || dados.passos.length === 0) return <p className="t3">nenhum passo de ataque identificado ainda</p>;

  return (
    <div className="mc">
      <p className="mc-h">
        <button type="button" className="pivot lbl" onClick={() => onAbrir(null)}>
          MAPA DO ATAQUE
        </button>{' '}
        · {dados.passos.length} passos · <span className={dados.semEdr ? 'red' : ''}>{dados.semEdr} máquina sem EDR</span>
        {dados.bytes > 0 && (
          <>
            {' '}
            · <span className="red">▲{bytesSI(dados.bytes)} saíram</span>
          </>
        )}{' '}
        <button type="button" className="btn-stamp" onClick={() => onAbrir(null)} aria-keyshortcuts="g m">
          [gm] abrir mapa
        </button>
      </p>
      <div className="mc-cols">
        {COLUNAS.map((c) => (
          <div key={c.key} className="mc-col">
            <span className="lbl t2">{c.titulo}</span>
            {modo === 'guiado' && <span className="t3 mc-sub">{c.sub}</span>}
            {dados.nos
              .filter((n) => n.coluna === c.key)
              .map((n) => (
                <span key={n.id} className="mc-no">
                  <span className="t3">{GLIFO[n.tipo] ?? '·'} </span>
                  {n.rotulo}
                  {n.flags.sem_edr && <span className="red"> ⊘</span>}
                </span>
              ))}
          </div>
        ))}
      </div>
      <p className="mc-passos">
        {dados.passos.map((a) => (
          <button key={a.id} type="button" className="mc-passo" onClick={() => onAbrir(dados.ordem.get(a.id)!)} title={a.rotulo}>
            <span className="chip-passo">[{dados.ordem.get(a.id)}]</span> <span className="num-data">{a.primeira.slice(11, 16)}</span>{' '}
            <span className="t2">
              {dados.rot.get(a.origem)} → {dados.rot.get(a.destino)}
            </span>
          </button>
        ))}
      </p>
    </div>
  );
}
