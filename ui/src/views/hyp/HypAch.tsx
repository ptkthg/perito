// F6 HIPÓTESES & ACHADOS (/hipoteses + /achados), duas colunas.
// Hipóteses: carimbo ◇HIP·confiança; aberta (âmbar), confirmada (contorno duplo),
// refutada (tachada, --text-3), inconclusiva. Achados: tabela A1..An com ■EVID.
// Refs (arquivo.csv:15-17, entra.json#3, A6) abrem a F1 com os eventos selecionados.
// Teclas: j/k item · h/l coluna · Enter abre as evidências do item · / filtra.
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ApiError, ConflitoError, api, describeError } from '../../lib/api';
import type { MsgAcao } from '../../lib/msg';
import { ConflictPanel } from '../bench/ConflictPanel';
import type { Achado, Hipotese } from '../../lib/types';
import type { Modo } from '../../lib/mode';
import { type ViewHandle, moveKey } from '../../lib/view';
import { useLoad } from '../../lib/useLoad';
import { tecnicaPt } from '../../lib/attack-pt';
import { RichText } from '../../components/RichText';
import type { PromptMode } from '../../components/CommandLine';
import type { MsgKind } from '../timeline/Timeline';

interface Props {
  caso: string;
  modo: Modo;
  /** Resolve refs/IDs de achado (texto livre) e abre a F1 com os eventos. */
  onOpenRefs(texto: string, achados: Achado[], rotulo: string): void;
  onMsg(text: string, kind?: MsgKind): void;
  onPrompt(prefill: string, mode: PromptMode): void;
  rev: number;
  /** Escrita concluída (o shell recarrega e mostra a mensagem com as ações). */
  onEscrito(msg: string, acoes?: MsgAcao[]): void;
  /** [a] gerar achado a partir de uma hipótese confirmada. */
  onGerarAchado(h: Hipotese, achados: Achado[]): void;
}

const STATUS = [
  { k: '1', v: 'aberta' },
  { k: '2', v: 'confirmada' },
  { k: '3', v: 'refutada' },
  { k: '4', v: 'inconclusiva' },
] as const;
const CONFIANCAS = [
  { k: 'b', v: 'baixa' },
  { k: 'm', v: 'média' },
  { k: 'l', v: 'alta' },
] as const;

interface Edicao {
  hid: string;
  status: 'confirmada' | 'refutada';
  texto: string;
  erro: string | null;
}

const CONF: Record<string, string> = { baixa: 'BAI', média: 'MÉD', media: 'MÉD', alta: 'ALT' };

function statusKey(s: string | null): 'aberta' | 'confirmada' | 'refutada' | 'inconclusiva' | 'outro' {
  const v = (s ?? '').toLowerCase();
  if (v.startsWith('abert')) return 'aberta';
  if (v.startsWith('confirm')) return 'confirmada';
  if (v.startsWith('refut')) return 'refutada';
  if (v.startsWith('inconc')) return 'inconclusiva';
  return 'outro';
}

const CAMPOS: { k: keyof Hipotese; analista: string; guiado: string }[] = [
  { k: 'fase', analista: 'FASE', guiado: 'FASE DO ATAQUE' },
  { k: 'sustentacao', analista: 'SUSTENTAÇÃO', guiado: 'O QUE SUSTENTA' },
  { k: 'confirmaria', analista: 'CONFIRMARIA', guiado: 'CONFIRMA SE' },
  { k: 'refutaria', analista: 'REFUTARIA', guiado: 'DERRUBA SE' },
  { k: 'proximo_passo', analista: 'PRÓXIMO PASSO', guiado: 'PRÓXIMO PASSO' },
  { k: 'contradiz', analista: 'CONTRADIZ', guiado: 'CONTRADIZ' },
  { k: 'justificativa', analista: 'JUSTIFICATIVA', guiado: 'JUSTIFICATIVA' },
];

const hipTexto = (h: Hipotese) => [h.id, h.titulo, h.status, h.fase, h.sustentacao, h.confirmaria, h.refutaria, h.proximo_passo, ...h.refs].join(' ');
const achTexto = (a: Achado) => [a.id, a.utc, a.host, a.conta, a.achado, ...a.attack, ...a.evidencia].join(' ');

export const HypAch = forwardRef<ViewHandle, Props>(function HypAch({ caso, modo, onOpenRefs, onMsg, onPrompt, rev, onEscrito, onGerarAchado }, ref) {
  const guiado = modo === 'guiado';
  const hip = useLoad(() => api.hipoteses(caso), [caso, rev]);
  const ach = useLoad(() => api.achados(caso), [caso, rev]);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [erroCard, setErroCard] = useState<{ hid: string; msg: string } | null>(null);
  const [conflito, setConflito] = useState<{ hid: string; base: string | null; atual: string; refazer: () => void } | null>(null);
  const justRef = useRef<HTMLTextAreaElement>(null);
  const achados = useMemo(() => (ach?.ok ? ach.v : []), [ach]);
  const [busca, setBusca] = useState('');
  const [col, setCol] = useState(0);
  const [rows, setRows] = useState([0, 0]);
  const rootRef = useRef<HTMLDivElement>(null);

  const t = busca.toLowerCase();
  const hips = useMemo(() => (hip?.ok ? hip.v.filter((h) => !t || hipTexto(h).toLowerCase().includes(t)) : []), [hip, t]);
  const achs = useMemo(() => achados.filter((a) => !t || achTexto(a).toLowerCase().includes(t)), [achados, t]);

  const abrir = (texto: string, rotulo: string) => onOpenRefs(texto, achados, rotulo);
  const abrirItem = (c: number, r: number) => {
    if (c === 0) {
      const h = hips[r];
      if (h) abrir(h.refs.join('; ') || hipTexto(h), h.id);
    } else {
      const a = achs[r];
      if (a) abrir(a.evidencia.join('; '), a.id);
    }
  };

  const setPos = (c: number, r: number, focus = true) => {
    setCol(c);
    setRows((rs) => rs.map((x, i) => (i === c ? r : x)));
    if (focus)
      requestAnimationFrame(() => {
        const el = rootRef.current?.querySelector<HTMLElement>(`[data-ha="${c}:${r}"]`);
        (el ?? rootRef.current)?.focus();
      });
  };

  /** PATCH na hipótese, com conflito 409 inline e erro do backend no próprio card. */
  const patch = async (h: Hipotese, body: Parameters<typeof api.patchHipotese>[2], ok: (h: Hipotese) => void) => {
    setErroCard(null);
    let base: string | null = null;
    try {
      base = (await api.doc(caso, 'hipoteses')).conteudo; // versão atual + base do diff
    } catch {
      /* segue com a versão conhecida */
    }
    const tentar = async (): Promise<void> => {
      try {
        await api.patchHipotese(caso, h.id, body);
        setConflito(null);
        setEdicao(null);
        ok(h);
      } catch (x) {
        if (x instanceof ConflitoError) {
          setConflito({
            hid: h.id,
            base,
            atual: x.conflito.conteudoAtual,
            refazer: () => {
              void api.doc(caso, 'hipoteses').then((d) => {
                base = d.conteudo;
                void tentar();
              });
            },
          });
        } else {
          const m = x instanceof ApiError ? `${x.message}${x.detalhe ? ` — ${x.detalhe}` : ''}` : describeError(x);
          if (edicao && edicao.hid === h.id) setEdicao({ ...edicao, erro: m });
          else setErroCard({ hid: h.id, msg: m });
          onMsg(`✕ ${h.id} não alterada: ${m}`, 'err');
        }
      }
    };
    await tentar();
  };

  const mudarStatus = (h: Hipotese, v: string) => {
    if (v === 'confirmada' || v === 'refutada') {
      setEdicao({ hid: h.id, status: v, texto: '', erro: null });
      requestAnimationFrame(() => justRef.current?.focus());
      return;
    }
    void patch(h, { status: v }, () => onEscrito(`✓ ${h.id} → ${v.toUpperCase()} → hipoteses.md`));
  };

  const confirmarEdicao = (h: Hipotese) => {
    if (!edicao) return;
    if (edicao.texto.trim().length < 3) {
      setEdicao({ ...edicao, erro: `justificativa obrigatória para ${edicao.status === 'confirmada' ? 'confirmar' : 'refutar'}` });
      justRef.current?.focus();
      return;
    }
    const st = edicao.status;
    void patch(h, { status: st, justificativa: edicao.texto.trim() }, (hh) => {
      if (st === 'confirmada') {
        onEscrito(`✓ ${hh.id} CONFIRMADA → hipoteses.md`, [{ tecla: 'a', rotulo: 'gerar achado', fazer: () => onGerarAchado(hh, achados) }]);
      } else {
        const semContra = !(hh.contradiz ?? '').trim();
        onEscrito(`✓ ${hh.id} REFUTADA → hipoteses.md${semContra ? ' · aviso: nenhum evento "contradiz" vinculado' : ''}`);
      }
    });
  };

  useImperativeHandle(ref, () => ({
    onKey(e) {
      // F6: b/m/l = confiança e 1-4 = status (brief §10); colunas só com ←/→.
      const hsel = col === 0 ? hips[rows[0] ?? 0] : undefined;
      if (hsel) {
        const st = STATUS.find((x) => x.k === e.key);
        if (st) {
          mudarStatus(hsel, st.v);
          return true;
        }
        const cf = CONFIANCAS.find((x) => x.k === e.key);
        if (cf) {
          void patch(hsel, { confianca: cf.v }, () => onEscrito(`✓ ${hsel.id} confiança ${cf.v.toUpperCase()} → hipoteses.md`));
          return true;
        }
      }
      if (e.key === 'h' || e.key === 'l') return false;
      const mv = moveKey(e.key, col, rows[col] ?? 0, 2, (c) => (c === 0 ? hips.length : achs.length));
      if (mv) {
        setPos(mv.col, mv.row);
        return true;
      }
      if (e.key === 'Enter') {
        abrirItem(col, rows[col] ?? 0);
        return true;
      }
      if (e.key === '/') {
        onPrompt('', 'search');
        return true;
      }
      return false;
    },
    search: (s) => setBusca(s),
    searchCommit: (s) => {
      setBusca(s);
      setRows([0, 0]);
    },
    searchCancel: () => setBusca(''),
    escape() {
      if (conflito) {
        setConflito(null);
        return true;
      }
      if (edicao) {
        setEdicao(null);
        onMsg('alteração de status cancelada', 'info');
        return true;
      }
      if (!busca) return false;
      setBusca('');
      onMsg('filtro limpo', 'info');
      return true;
    },
    focus() {
      setPos(col, rows[col] ?? 0);
    },
  }));

  return (
    <div className="ha" ref={rootRef} tabIndex={-1} data-tour="hipoteses">
      {busca && (
        <div className="strip">
          <span className="lbl t2">BUSCA</span> <span className="amber">/{busca}</span> <span className="t3">· Esc limpa</span>
        </div>
      )}
      <div className="ha-cols">
        <section className={`ha-col${col === 0 ? ' is-col' : ''}`} aria-labelledby="ha-h">
          <h2 id="ha-h" className="lbl ov-h ha-h">
            {guiado ? 'HIPÓTESES (o que achamos que aconteceu)' : 'HIPÓTESES'}{' '}
            <span className="t3 num-data">{hip?.ok ? `${hips.length}/${hip.v.length}` : ''}</span>
          </h2>
          {!hip && <p className="inline-state t3">CARREGANDO hipoteses.md ...</p>}
          {hip && !hip.ok && <p className="inline-state red">ERRO {hip.err}</p>}
          {hip?.ok && hip.v.length === 0 && (
            <p className="inline-state">
              <span className="lbl">NENHUMA HIPÓTESE REGISTRADA</span> <span className="t3">▮</span>{' '}
              <span className="t2">peça ao Claude: "investigar"</span>
            </p>
          )}
          <ol className="ha-list">
            {hips.map((h, ri) => {
              const st = statusKey(h.status);
              const isSel = col === 0 && ri === (rows[0] ?? 0);
              const conf = h.confianca ? (CONF[h.confianca.toLowerCase()] ?? h.confianca.toUpperCase().slice(0, 3)) : null;
              return (
                <li
                  key={h.id}
                  className={`hip hip-${st}${isSel ? ' is-sel' : ''}`}
                  data-ha={`0:${ri}`}
                  tabIndex={isSel ? 0 : -1}
                  onClick={() => setPos(0, ri, false)}
                  aria-label={`${h.id} ${h.titulo} — ${h.status ?? 'sem status'}`}
                >
                  <div className="hip-l1">
                    <span className="selbar" aria-hidden>
                      {isSel ? '▌' : ' '}
                    </span>
                    <span className={`stamp stamp-hip${st === 'confirmada' ? ' stamp-dupla' : ''}`} title={conf ? `confiança ${h.confianca}` : 'confiança não informada'}>
                      ◇HIP{conf ? `·${conf}` : '·?'}
                    </span>{' '}
                    <span className="hip-id">{h.id}</span> <span className="hip-tit">{h.titulo}</span>{' '}
                    <span className={`lbl hip-st hip-st-${st}`}>{(h.status ?? 'sem status').toUpperCase()}</span>
                  </div>
                  <dl className="hip-dl">
                    {CAMPOS.map((c) => {
                      const v = h[c.k];
                      if (!v || typeof v !== 'string') return null;
                      return (
                        <div key={c.k}>
                          <dt className="lbl t2">{guiado ? c.guiado : c.analista}</dt>
                          <dd>
                            <RichText text={v} onRef={(r) => abrir(r, r)} />
                          </dd>
                        </div>
                      );
                    })}
                    {h.refs.length > 0 && (
                      <div>
                        <dt className="lbl t2">REFS</dt>
                        <dd>
                          {h.refs.map((r) => (
                            <button key={r} type="button" className="pivot ref-link" onClick={() => abrir(r, r)}>
                              {r}
                            </button>
                          ))}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {isSel && (
                    <div className="hip-acts">
                      {guiado ? (
                        <>
                          <span className="lbl t2">STATUS</span>{' '}
                          {STATUS.map((x) => (
                            <button key={x.v} type="button" className={`btn-stamp${st === x.v ? ' is-on' : ''}`} onClick={() => mudarStatus(h, x.v)}>
                              [{x.k}] {x.v}
                            </button>
                          ))}{' '}
                          <span className="lbl t2">CONFIANÇA</span>{' '}
                          {CONFIANCAS.map((x) => (
                            <button
                              key={x.v}
                              type="button"
                              className={`btn-stamp${(h.confianca ?? '').startsWith(x.v.slice(0, 3)) ? ' is-on' : ''}`}
                              onClick={() => void patch(h, { confianca: x.v }, () => onEscrito(`✓ ${h.id} confiança ${x.v.toUpperCase()} → hipoteses.md`))}
                            >
                              [{x.k}] {x.v}
                            </button>
                          ))}
                        </>
                      ) : (
                        <span className="t3">[1]ABERTA [2]CONFIRMADA [3]REFUTADA [4]INCONCLUSIVA · [b]BAIXA [m]MÉDIA [l]ALTA · ↵ evidências</span>
                      )}
                    </div>
                  )}
                  {edicao?.hid === h.id && (
                    <div
                      className="bench hip-just"
                      onKeyDown={(e) => {
                        if (/^F\d$/.test(e.key)) return;
                        e.stopPropagation();
                        if (e.key === 'Enter' && e.ctrlKey) {
                          e.preventDefault();
                          confirmarEdicao(h);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEdicao(null);
                        }
                      }}
                    >
                      <label className="bench-l lbl t2" htmlFor={`just-${h.id}`}>
                        JUSTIFICATIVA PARA {edicao.status === 'confirmada' ? 'CONFIRMAR' : 'REFUTAR'} (obrigatória)
                      </label>
                      {guiado && (
                        <p className="bench-help t2">
                          {edicao.status === 'confirmada'
                            ? 'Diga quais evidências comprovam. Confirmar exige ao menos um evento "apoia" (vincule com H na timeline).'
                            : 'Diga o que mostra que a hipótese não se sustenta. O ideal é ter um evento "contradiz" vinculado.'}
                        </p>
                      )}
                      <textarea
                        id={`just-${h.id}`}
                        ref={justRef}
                        className="bench-ta"
                        rows={3}
                        value={edicao.texto}
                        aria-invalid={!!edicao.erro}
                        onChange={(e) => setEdicao({ ...edicao, texto: e.target.value, erro: null })}
                      />
                      {edicao.erro && (
                        <p className="red bench-err" role="alert">
                          ✕ {edicao.erro}
                        </p>
                      )}
                      <p className="bench-actions">
                        <button type="button" className="btn-stamp btn-main" onClick={() => confirmarEdicao(h)}>
                          {guiado ? `Gravar ${edicao.status} (Ctrl+Enter)` : 'Ctrl+Enter grava'}
                        </button>{' '}
                        <button type="button" className="btn-stamp" onClick={() => setEdicao(null)}>
                          {guiado ? 'Cancelar (Esc)' : 'Esc'}
                        </button>
                      </p>
                    </div>
                  )}
                  {erroCard?.hid === h.id && (
                    <p className="red bench-err" role="alert">
                      ✕ {erroCard.msg}
                    </p>
                  )}
                  {conflito?.hid === h.id && (
                    <ConflictPanel arquivo="hipoteses.md" base={conflito.base} atual={conflito.atual} modo={modo} onRecarregar={conflito.refazer} onManter={() => setConflito(null)} />
                  )}
                  <span className="t3 hip-linha">hipoteses.md:{h.linha}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className={`ha-col${col === 1 ? ' is-col' : ''}`} aria-labelledby="ach-h">
          <h2 id="ach-h" className="lbl ov-h ha-h">
            {guiado ? 'ACHADOS (fatos comprovados nos registros)' : 'ACHADOS'}{' '}
            <span className="t3 num-data">{ach?.ok ? `${achs.length}/${ach.v.length}` : ''}</span>
          </h2>
          {!ach && <p className="inline-state t3">CARREGANDO achados.md ...</p>}
          {ach && !ach.ok && <p className="inline-state red">ERRO {ach.err}</p>}
          {ach?.ok && ach.v.length === 0 && (
            <p className="inline-state">
              <span className="lbl">NENHUM ACHADO REGISTRADO</span> <span className="t3">▮</span>{' '}
              <span className="t2">promova eventos com [a] na timeline (entrega E3)</span>
            </p>
          )}
          {achs.length > 0 && (
            <table className="ach">
              <thead>
                <tr className="lbl t2">
                  <th>#</th>
                  <th>{guiado ? 'HORÁRIO (UTC)' : 'UTC'}</th>
                  <th>{guiado ? 'MÁQUINA' : 'HOST'}</th>
                  <th>{guiado ? 'CONTA' : 'CONTA'}</th>
                  <th>ACHADO</th>
                  <th>{guiado ? 'TÉCNICA' : 'ATT&CK'}</th>
                  <th>{guiado ? 'PROVA' : 'EVIDÊNCIA'}</th>
                </tr>
              </thead>
              <tbody>
                {achs.map((a, ri) => {
                  const isSel = col === 1 && ri === (rows[1] ?? 0);
                  return (
                    <tr
                      key={a.id}
                      className={isSel ? 'is-sel' : ''}
                      data-ha={`1:${ri}`}
                      tabIndex={isSel ? 0 : -1}
                      onClick={() => setPos(1, ri, false)}
                      onDoubleClick={() => abrirItem(1, ri)}
                    >
                      <td>
                        <button type="button" className="pivot" onClick={() => abrir(a.evidencia.join('; '), a.id)} title={`abrir evidências de ${a.id} na timeline`}>
                          {a.id}
                        </button>{' '}
                        <span className="stamp stamp-evid" title="evidência: comprovado nos registros">
                          ■EVID
                        </span>
                      </td>
                      <td className="num-data nowrap" title={a.utc}>
                        {a.utc.replace(/\d{4}-\d{2}-\d{2}T/g, '')}
                      </td>
                      <td className="nowrap">{a.host ?? <span className="t3">—</span>}</td>
                      <td className="nowrap">{a.conta ?? <span className="t3">—</span>}</td>
                      <td className="ach-txt">
                        <RichText text={a.achado} />
                      </td>
                      <td title={a.attack.join(' · ')}>
                        {a.attack.length === 0 ? <span className="t3">—</span> : a.attack.map((x) => <div key={x}>{guiado ? tecnicaPt(x) : x}</div>)}
                      </td>
                      <td>
                        {a.evidencia.map((r) => (
                          <div key={r}>
                            <button type="button" className="pivot ref-link" onClick={() => abrir(r, r)}>
                              {r}
                            </button>
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
});
