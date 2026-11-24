// MAPA DO ATAQUE (brief §9, `gm`, comando `mapa`).
// 4 colunas fixas em ch + canais de 8ch; nós em CSS (borda = tipo), arestas em SVG ortogonais
// com ponta, chip [n] do caminho, ponte nos cruzamentos. Sem física, sem pan/zoom animado.
// Teclado (widget composto, uma parada de Tab): ←→ coluna · ↑↓ nó · n/N passo · . , arestas do nó
// · c só o caminho · + - grupo · Enter/p pivota (nó) ou abre eventos (aresta) · Tab → lista CAMINHO.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { Resumo } from '../../lib/types';
import type { Modo } from '../../lib/mode';
import type { ViewHandle } from '../../lib/view';
import { useLoad } from '../../lib/useLoad';
import { useCharWidth } from '../../lib/hooks';
import { makeTacticOf, sortTechniques, tecnicaPt } from '../../lib/attack-pt';
import {
  CANAL_CH,
  COLUNAS,
  type GrafoNo,
  type LAresta,
  type LNo,
  espacarChips,
  frasePasso,
  layoutMapa,
  metricaAresta,
  rotear,
  rotuloTipoNo,
} from '../../lib/graph';
import type { MsgKind } from '../../lib/msg';

interface Props {
  caso: string;
  modo: Modo;
  rev: number;
  rowH: number;
  resumo: Resumo | null;
  /** Passo a focar ao abrir (vindo da Visão Geral). */
  focoPasso: number | null;
  onOpenEdge(idxs: number[], rotulo: string): void;
  onPivotNode(no: GrafoNo): void;
  onMsg(text: string, kind?: MsgKind): void;
}

const hhmm = (iso: string) => iso.slice(11, 16);
const hms = (iso: string) => iso.slice(11, 19);

export const AttackMap = forwardRef<ViewHandle, Props>(function AttackMap(props, ref) {
  const { caso, modo, rev, rowH, resumo, focoPasso, onOpenEdge, onPivotNode, onMsg } = props;
  const guiado = modo === 'guiado';
  const g = useLoad(() => api.grafo(caso), [caso, rev]);
  const chPx = useCharWidth();
  const [soCaminho, setSoCaminho] = useState(false);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [selNo, setSelNo] = useState<string | null>(null);
  const [selAresta, setSelAresta] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const tacticOf = useMemo(() => makeTacticOf(resumo?.tecnicas), [resumo]);

  const lay = useMemo(() => (g?.ok ? layoutMapa(g.v, { recolherRuido: guiado, soCaminho, expandidos }) : null), [g, guiado, soCaminho, expandidos]);

  // métricas em px a partir da grade de caracteres (o "zoom" é a densidade)
  const m = useMemo(() => {
    const colW = COLUNAS.map((c) => c.ch * chPx);
    const canal = CANAL_CH * chPx;
    const colX: number[] = [];
    let x = 0;
    for (let i = 0; i < COLUNAS.length; i++) {
      colX.push(x);
      x += colW[i]! + canal;
    }
    // cabeçalho das colunas: 1 linha (ANALISTA) ou 2 (GUIADO, com subtítulo) + folga para o rótulo do tipo
    return { colX, colW, canal, noH: 3 * rowH, slotH: 4 * rowH, topo: Math.round((guiado ? 2.6 : 1.6) * rowH), largura: x - canal };
  }, [chPx, rowH, guiado]);

  const rotas = useMemo(() => (lay ? rotear(lay, m) : []), [lay, m]);
  const rotaDe = useMemo(() => new Map(rotas.map((r) => [r.id, r])), [rotas]);
  // posição final dos chips/métricas, sem sobreposição no mesmo canal
  const chipPos = useMemo(() => {
    if (!lay) return new Map<string, [number, number]>();
    const pts = lay.arestas
      .filter((a) => a.passo !== null || metricaAresta(a).texto)
      .map((a) => ({ id: a.id, x: rotaDe.get(a.id)?.chip[0] ?? 0, y: rotaDe.get(a.id)?.chip[1] ?? 0 }));
    return espacarChips(pts, Math.round(rowH * 1.3));
  }, [lay, rotaDe, rowH]);
  const altura = lay ? m.topo + Math.max(1, ...lay.colunas.map((c) => c.length)) * m.slotH : 0;

  // Avisos de escala (§9.6) e foco inicial vindo da Visão Geral.
  const avisou = useRef(false);
  useEffect(() => {
    if (!g?.ok || avisou.current) return;
    if (g.v.nos.length > 80) {
      avisou.current = true;
      onMsg(`mapa com ${g.v.nos.length} nós: refine com > mapa --desde 13:00 --host …`, 'info');
    }
  }, [g, onMsg]);
  useEffect(() => {
    if (!lay || focoPasso == null) return;
    const id = lay.passos[focoPasso - 1];
    if (id) {
      setSelAresta(id);
      setSelNo(null);
    }
  }, [lay, focoPasso]);

  const nosDe = (id: string | null) => (id && lay ? lay.nos.get(id) ?? null : null);
  const arestaDe = (id: string | null) => (id && lay ? lay.arestas.find((a) => a.id === id) ?? null : null);
  const arestasDoNo = (id: string) => (lay ? lay.arestas.filter((a) => a.origem === id || a.destino === id) : []);
  const rotuloNo = (id: string) => lay?.nos.get(id)?.rotulo ?? id.split(':').slice(1).join(':');

  const abrirAresta = (a: LAresta) => onOpenEdge(a.idxs, a.passo ? `[${a.passo}] ${a.rotulo}` : a.rotulo);

  const clicarNo = (n: LNo) => {
    if (n.membros) {
      setExpandidos((s) => new Set(s).add(n.id));
      onMsg(`grupo expandido: ${n.rotulo.replace(/^\+/, '')} · - recolhe`, 'info');
      return;
    }
    if (selNo === n.id && !selAresta) onPivotNode(n);
    else {
      setSelNo(n.id);
      setSelAresta(null);
    }
  };

  const foco = () => mapRef.current?.focus();

  useImperativeHandle(ref, () => ({
    onKey(e) {
      if (!lay) return false;
      const atual = nosDe(selNo);
      const col = atual?.col ?? 0;
      const lista = lay.colunas[col] ?? [];
      const idx = atual ? lista.findIndex((n) => n.id === atual.id) : -1;
      const sel = (n: LNo | undefined) => {
        if (!n) return;
        setSelNo(n.id);
        setSelAresta(null);
        foco();
      };
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          sel(lista[Math.min(lista.length - 1, idx + 1)] ?? lista[0]);
          return true;
        case 'ArrowUp':
        case 'k':
          sel(lista[Math.max(0, idx - 1)] ?? lista[0]);
          return true;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'h':
        case 'l': {
          const d = e.key === 'ArrowLeft' || e.key === 'h' ? -1 : 1;
          let c = col + (atual ? d : 0);
          while (c >= 0 && c < lay.colunas.length && (lay.colunas[c]?.length ?? 0) === 0) c += d;
          const alvo = lay.colunas[c];
          if (alvo?.length) sel(alvo[Math.min(Math.max(0, atual ? atual.slot : 0), alvo.length - 1)]);
          return true;
        }
        case 'n':
        case 'N': {
          if (!lay.passos.length) {
            onMsg('nenhum passo de ataque identificado', 'info');
            return true;
          }
          const cur = selAresta ? lay.passos.indexOf(selAresta) : -1;
          const nx = e.key === 'n' ? (cur + 1) % lay.passos.length : (cur - 1 + lay.passos.length) % lay.passos.length;
          setSelAresta(lay.passos[nx]!);
          setSelNo(null);
          foco();
          const a = arestaDe(lay.passos[nx]!);
          if (a) onMsg(`[${a.passo}] ${hms(a.primeira)} ${rotuloNo(a.origem)} → ${rotuloNo(a.destino)} · ${a.rotulo} · Enter ver eventos`, 'info');
          return true;
        }
        case '.':
        case ',': {
          const base = selNo ?? (selAresta ? arestaDe(selAresta)?.origem ?? null : null);
          if (!base) return true;
          const as = arestasDoNo(base);
          if (!as.length) {
            onMsg('nó sem arestas', 'info');
            return true;
          }
          const cur = selAresta ? as.findIndex((a) => a.id === selAresta) : -1;
          const nx = e.key === '.' ? (cur + 1) % as.length : (cur - 1 + as.length) % as.length;
          setSelAresta(as[nx]!.id);
          setSelNo(base);
          return true;
        }
        case 'c':
          setSoCaminho((v) => !v);
          onMsg(soCaminho ? 'mapa completo' : 'só o caminho do atacante (c volta)', 'info');
          return true;
        case '+':
        case '=': {
          const alvo = atual?.membros ? [atual.id] : [...lay.grupos.keys()];
          if (!alvo.length) return true;
          setExpandidos((s) => new Set([...s, ...alvo]));
          return true;
        }
        case '-':
          setExpandidos(new Set());
          setSelNo(null);
          return true;
        case 'Enter':
        case 'p': {
          const a = arestaDe(selAresta);
          if (a) abrirAresta(a);
          else if (atual) clicarNo(atual);
          return true;
        }
        default:
          return false;
      }
    },
    escape() {
      if (selAresta || selNo) {
        setSelAresta(null);
        setSelNo(null);
        return true;
      }
      return false;
    },
    focus: foco,
  }));

  if (!g) return <p className="inline-state t3">CARREGANDO /grafo ...</p>;
  if (!g.ok) return <p className="inline-state red">ERRO {g.err}</p>;
  if (!lay) return null;
  if (g.v.nos.length === 0)
    return (
      <p className="inline-state">
        <span className="lbl">MAPA VAZIO</span> <span className="t3">▮</span> <span className="t2">ingira evidências para ver quem falou com quem</span>
      </p>
    );

  const destacadas = new Set<string>();
  const focoNo = hover ?? selNo;
  if (focoNo) for (const a of arestasDoNo(focoNo)) destacadas.add(a.id);
  const aSel = arestaDe(selAresta);
  const nSel = nosDe(selNo);
  const passosArestas = lay.passos.map((id) => arestaDe(id)!).filter(Boolean);

  return (
    <div className="mapa">
      <div className="mapa-main">
        <div className="mapa-scroll">
          <div
            className="mapa-canvas"
            ref={mapRef}
            tabIndex={0}
            role="group"
            aria-roledescription="mapa do ataque"
            aria-label={`Mapa do ataque: ${g.v.nos.length} nós, ${g.v.arestas.length} ligações, ${lay.passos.length} passos. Setas navegam, n próximo passo, Enter abre.`}
            aria-describedby="mapa-sel"
            style={{ width: m.largura, height: altura }}
          >
            {/* cabeçalhos das colunas */}
            {COLUNAS.map((c, i) => (
              <div key={c.key} className="mapa-colh" style={{ left: m.colX[i], width: m.colW[i], height: Math.round(m.topo - 0.6 * rowH) }}>
                <span className="lbl">{c.titulo}</span>
                {guiado && <span className="t3 mapa-colsub">{c.sub}</span>}
              </div>
            ))}
            {/* canais */}
            {COLUNAS.slice(0, -1).map((c, i) => (
              <div key={c.key} className="mapa-canal" style={{ left: m.colX[i]! + m.colW[i]!, width: m.canal, top: m.topo, height: altura - m.topo }} aria-hidden />
            ))}
            <svg className="mapa-svg" width={m.largura} height={altura} aria-hidden>
              <defs>
                <marker id="pt-amb" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M0 0L6 3L0 6z" className="pt-amb" />
                </marker>
                <marker id="pt-mut" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M0 0L6 3L0 6z" className="pt-mut" />
                </marker>
                <marker id="pt-sel" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M0 0L6 3L0 6z" className="pt-sel" />
                </marker>
              </defs>
              {lay.arestas.map((a) => {
                const r = rotaDe.get(a.id);
                if (!r) return null;
                const caminho = a.passo !== null;
                const so = a.falha > 0 && a.sucesso === 0;
                const apagada = focoNo && !destacadas.has(a.id);
                const sel = a.id === selAresta;
                return (
                  <g key={a.id} className={`ar${caminho ? ' ar-cam' : ''}${so ? ' ar-falha' : ''}${apagada ? ' ar-off' : ''}${sel ? ' ar-sel' : ''}`}>
                    <path d={r.d} className="ar-linha" markerEnd={`url(#${sel ? 'pt-sel' : caminho ? 'pt-amb' : 'pt-mut'})`} />
                    <path d={r.d} className="ar-hit" onClick={() => abrirAresta(a)} />
                  </g>
                );
              })}
            </svg>
            {/* nós */}
            {lay.colunas.flat().map((n) => {
              const sel = n.id === selNo;
              const semBorda = n.tipo === 'ip' || n.tipo === 'dominio';
              return (
                <div
                  key={n.id}
                  id={`no-${n.id}`}
                  className={`no no-${n.membros ? 'grupo' : n.tipo}${n.flags.sem_edr ? ' no-semedr hatch' : ''}${sel ? ' is-sel' : ''}${n.noCaminho ? ' no-cam' : ''}${
                    focoNo && focoNo !== n.id && !arestasDoNo(focoNo).some((a) => a.origem === n.id || a.destino === n.id) ? ' no-off' : ''
                  }`}
                  style={{ left: m.colX[n.col], top: m.topo + n.slot * m.slotH, width: m.colW[n.col], height: m.noH }}
                  onClick={() => clicarNo(n)}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  {n.membros ? (
                    <span className="no-grupo t3">
                      {n.rotulo} <span className="btn-stamp no-mais">[+]</span>
                    </span>
                  ) : (
                    <>
                      <span className="no-tipo lbl">
                        {rotuloTipoNo(n)}
                        {n.flags.sem_edr && <span className="red"> ⊘ SEM EDR</span>}
                      </span>
                      <span className="no-rot">
                        {semBorda && <span className="t2">› </span>}
                        {n.rotulo}
                      </span>
                      <span className="no-meta t3">
                        {n.eventos} evt{n.tecnicas.length ? ` · ${n.tecnicas.length} técn.` : ''}
                        {n.ips?.length ? ` · ${n.ips.join(' ')}` : ''}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
            {/* chips [n] e métricas (alvos ≥ 24px) */}
            {lay.arestas.map((a) => {
              const r = rotaDe.get(a.id);
              if (!r) return null;
              const met = metricaAresta(a);
              if (a.passo === null && !met.texto) return null;
              return (
                <div key={a.id} className="ar-tags" style={{ left: chipPos.get(a.id)?.[0] ?? r.chip[0], top: chipPos.get(a.id)?.[1] ?? r.chip[1] }}>
                  {a.passo !== null && (
                    <button
                      type="button"
                      tabIndex={-1}
                      className={`chip-passo${a.id === selAresta ? ' is-sel' : ''}`}
                      onClick={() => abrirAresta(a)}
                      aria-label={`passo ${a.passo}: ${a.rotulo}; abrir eventos`}
                    >
                      [{a.passo}]
                    </button>
                  )}
                  {met.texto && <span className={`ar-met${met.tipo === 'volume' ? ' red' : ''}`}>{met.texto}</span>}
                </div>
              );
            })}
          </div>
        </div>

        <section className="mapa-cam" aria-labelledby="cam-h">
          <h2 id="cam-h" className="lbl ov-h">
            CAMINHO DO ATACANTE <span className="t3">(ordem cronológica)</span>
            <span className="t3 mapa-cam-hint"> [n] próximo passo · [Enter] ver eventos · [c] só o caminho</span>
          </h2>
          {passosArestas.length === 0 && <p className="inline-state t3">nenhuma ligação suspeita identificada</p>}
          <ol className="cam-list">
            {passosArestas.map((a) => {
              const tec = sortTechniques(a.tecnicas, tacticOf)[0];
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className={`cam-item${a.id === selAresta ? ' is-sel' : ''}`}
                    onClick={() => abrirAresta(a)}
                    onFocus={() => {
                      setSelAresta(a.id);
                      setSelNo(null);
                    }}
                  >
                    <span className="chip-passo">[{a.passo}]</span>{' '}
                    {guiado ? (
                      <>
                        <span className="num-data">{hhmm(a.primeira)}</span> <span>{frasePasso(a, rotuloNo(a.origem), rotuloNo(a.destino))}</span>{' '}
                        {tec && <span className="t2 cam-tec">{tecnicaPt(tec)}</span>}
                      </>
                    ) : (
                      <>
                        <span className="num-data">{tec ?? '—'}</span>{' '}
                        <span className="num-data t2">
                          {hms(a.primeira)}–{hms(a.ultima)}
                        </span>{' '}
                        <span>
                          {rotuloNo(a.origem)} → {rotuloNo(a.destino)}
                        </span>{' '}
                        <span className="t2">{a.rotulo}</span> <span className="t3">({a.contagem})</span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
          {guiado && (
            <p className="mapa-leg t2">
              <span className="lbl">LEGENDA</span> <span className="leg leg-host">┌─┐</span> máquina <span className="leg">╔═╗</span> conta <span className="leg">┏━┓</span>{' '}
              aplicativo <span className="leg">╎╌╎</span> e-mail <span className="leg">›</span> endereço externo <span className="chip-passo">[n]</span> passo do ataque{' '}
              <span className="red">⊘</span> sem EDR <span className="red">▲</span> volume alto ✕ falha ✓ sucesso <span className="leg">≡n</span> confirmado por n fontes ·
              tracejado = só falhas · clique 1× seleciona, 2× abre na F2
            </p>
          )}
        </section>
      </div>

      <aside className="mapa-det" aria-live="polite" id="mapa-sel">
        {!aSel && !nSel && (
          <p className="t3">
            {guiado ? 'clique num nó para ver os detalhes; clique de novo para abrir na F2. Clique numa ligação ou num [n] para ver os eventos.' : 'nada selecionado · ←→↑↓ n . c'}
          </p>
        )}
        {aSel && (
          <>
            <p className="lbl mapa-det-h">
              {aSel.passo !== null ? <span className="chip-passo">[{aSel.passo}]</span> : null} LIGAÇÃO · {aSel.tipo.toUpperCase()}
            </p>
            <dl className="dv">
              <div className="dv-pair">
                <dt className="lbl t2">DE</dt>
                <dd>{rotuloNo(aSel.origem)}</dd>
              </div>
              <div className="dv-pair">
                <dt className="lbl t2">PARA</dt>
                <dd>{rotuloNo(aSel.destino)}</dd>
              </div>
              <div className="dv-pair">
                <dt className="lbl t2">O QUÊ</dt>
                <dd>{aSel.rotulo}</dd>
              </div>
              <div className="dv-pair">
                <dt className="lbl t2">QUANDO</dt>
                <dd className="num-data">
                  {hms(aSel.primeira)}–{hms(aSel.ultima)}
                </dd>
              </div>
              <div className="dv-pair">
                <dt className="lbl t2">EVENTOS</dt>
                <dd>
                  {aSel.contagem} <span className="t3">(✓{aSel.sucesso} ✕{aSel.falha})</span>
                </dd>
              </div>
              {aSel.tecnicas.length > 0 && (
                <div className="dv-pair">
                  <dt className="lbl t2">TÉCNICAS</dt>
                  <dd>
                    {sortTechniques(aSel.tecnicas, tacticOf).map((t) => (
                      <div key={t}>
                        {t} <span className="t2">{tecnicaPt(t)}</span>
                      </div>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
            <p className="bench-actions">
              <button type="button" className="btn-stamp btn-main" onClick={() => abrirAresta(aSel)}>
                [Enter] ver {aSel.idxs.length} evento(s) na F1
              </button>
            </p>
          </>
        )}
        {nSel && !aSel && (
          <>
            <p className={`lbl mapa-det-h no-tipo-inv`}>
              {rotuloTipoNo(nSel)}
              {nSel.flags.sem_edr && <span> · ⊘ SEM EDR</span>}
            </p>
            <p className="mapa-det-rot">{nSel.rotulo}</p>
            <dl className="dv">
              <div className="dv-pair">
                <dt className="lbl t2">EVENTOS</dt>
                <dd>{nSel.eventos}</dd>
              </div>
              <div className="dv-pair">
                <dt className="lbl t2">QUANDO</dt>
                <dd className="num-data">
                  {hms(nSel.primeira)}–{hms(nSel.ultima)}
                </dd>
              </div>
              {nSel.tecnicas.length > 0 && (
                <div className="dv-pair">
                  <dt className="lbl t2">TÉCNICAS</dt>
                  <dd>
                    {sortTechniques(nSel.tecnicas, tacticOf).map((t) => (
                      <div key={t}>
                        {t} <span className="t2">{tecnicaPt(t)}</span>
                      </div>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
            <p className="lbl t2">LIGAÇÕES</p>
            <ul className="mapa-det-ar">
              {arestasDoNo(nSel.id).map((a) => (
                <li key={a.id}>
                  <button type="button" className="pivot" onClick={() => abrirAresta(a)}>
                    {a.passo !== null ? `[${a.passo}] ` : ''}
                    {a.origem === nSel.id ? `→ ${rotuloNo(a.destino)}` : `← ${rotuloNo(a.origem)}`}
                  </button>{' '}
                  <span className="t3">{a.rotulo}</span>
                </li>
              ))}
            </ul>
            {!nSel.membros && (
              <p className="bench-actions">
                <button type="button" className="btn-stamp btn-main" onClick={() => onPivotNode(nSel)}>
                  [Enter] abrir na F2 (pivô)
                </button>
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  );
});
