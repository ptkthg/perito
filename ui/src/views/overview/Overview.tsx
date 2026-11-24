// F0 VISÃO GERAL: conta a história do caso em linguagem simples, no layout de console.
// Seções: O QUE ACONTECEU · FASES DO ATAQUE · QUEM E O QUE FOI AFETADO ·
//         DÁ PARA CONFIAR NOS DADOS? · PRÓXIMOS PASSOS.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../../lib/api';
import type { Entidades, Hipotese, IocsResp, PeritoEvent, Resumo } from '../../lib/types';
import type { FilterField } from '../../lib/filters';
import { KILL_CHAIN, makeTacticOf, tecnicaPt } from '../../lib/attack-pt';
import { hhmm, sourceColor, tsMs } from '../../lib/format';
import { sourceLong } from '../../lib/mode';

interface Props {
  caso: string;
  resumo: Resumo | null;
  entidades: Entidades | null;
  onPivot(field: FilterField, value: string): void;
  onTatica(tatica: string): void;
  onCobertura(): void;
}

type Load<T> = { ok: true; v: T } | { ok: false; err: string } | null;

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Load<T> {
  const [st, setSt] = useState<Load<T>>(null);
  useEffect(() => {
    let vivo = true;
    setSt(null);
    fn()
      .then((v) => vivo && setSt({ ok: true, v }))
      .catch((e: unknown) => vivo && setSt({ ok: false, err: describeError(e) }));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return st;
}

// ---------- narrativa (## Resumo do caso.md) ----------
export function extractResumo(md: string): string[] | null {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+resumo\s*$/i.test(l.trim()));
  if (start < 0) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]!)) break;
    body.push(lines[i]!);
  }
  const paras = body
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  return paras.length ? paras : null;
}

const TOKEN = /(\[(?:EVID[EÊ]NCIA|HIP[OÓ]TESE|LIMITA[CÇ][AÃ]O)\]|\*\*[^*]+\*\*|`[^`]+`)/giu;

function Inline({ text }: { text: string }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        const up = p.toUpperCase();
        if (/^\[EVID/.test(up)) return <span key={i} className="stamp stamp-evid" title="comprovado nos registros">■EVID</span>;
        if (/^\[HIP/.test(up)) return <span key={i} className="stamp stamp-hip" title="suposição ainda não comprovada">◇HIP</span>;
        if (/^\[LIMITA/.test(up)) return <span key={i} className="stamp stamp-lim hatch" title="não temos dados para saber">⊘LIM</span>;
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

// ---------- kill chain ----------
interface Fase {
  tatica: string;
  rotulo: string;
  eventos: number;
  primeiro: string | null;
  tecnicas: { id: string; n: number }[];
  sugerido: boolean;
}

function computeFases(events: PeritoEvent[], resumo: Resumo | null): Fase[] {
  const tacticOf = makeTacticOf(resumo?.tecnicas);
  const acc = new Map<string, { n: number; first: string | null; techs: Map<string, number>; allHeur: boolean }>();
  for (const ev of events) {
    const seen = new Set<string>();
    const heur = ev.extra.mitre_heuristica ?? [];
    for (const t of ev.mitre) {
      const tac = tacticOf(t);
      if (!tac) continue;
      const a = acc.get(tac) ?? { n: 0, first: null, techs: new Map(), allHeur: true };
      if (!seen.has(tac)) {
        a.n += 1;
        seen.add(tac);
        if (!a.first || ev.ts_utc < a.first) a.first = ev.ts_utc;
      }
      a.techs.set(t, (a.techs.get(t) ?? 0) + 1);
      if (!heur.includes(t)) a.allHeur = false;
      acc.set(tac, a);
    }
  }
  return KILL_CHAIN.map((k) => {
    const a = acc.get(k.tatica);
    return {
      tatica: k.tatica,
      rotulo: k.rotulo,
      eventos: a?.n ?? 0,
      primeiro: a?.first ?? null,
      tecnicas: a ? [...a.techs.entries()].map(([id, n]) => ({ id, n })).sort((x, y) => y.n - x.n || x.id.localeCompare(y.id)) : [],
      sugerido: !!a && a.allHeur,
    };
  });
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id: string }) {
  return (
    <section className="ov-sec" aria-labelledby={id}>
      <h2 id={id} className="lbl ov-h">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Overview({ caso, resumo, entidades, onPivot, onTatica, onCobertura }: Props) {
  const doc = useLoad(() => api.doc(caso, 'caso'), [caso]);
  const hip = useLoad<Hipotese[]>(() => api.hipoteses(caso), [caso]);
  const iocs = useLoad<IocsResp>(() => api.iocs(caso), [caso]);
  const evs = useLoad(() => api.eventos(caso, {}), [caso]);

  const resumoParas = doc?.ok ? extractResumo(doc.v.conteudo) : null;
  const fases = useMemo(() => (evs?.ok ? computeFases(evs.v.eventos, resumo) : null), [evs, resumo]);
  const abertas = hip?.ok ? hip.v.filter((h) => (h.status ?? '').toLowerCase() === 'aberta') : [];
  const semEdr = new Set(resumo?.hosts_sem_edr ?? []);

  const top = (kind: 'host' | 'user', n = 10) =>
    Object.entries(entidades?.[kind] ?? {})
      .sort((a, b) => b[1].eventos - a[1].eventos)
      .slice(0, n);
  const ext = (tipo: string) => (iocs?.ok ? iocs.v.candidatos.filter((c) => c.tipo === tipo).slice(0, 10) : []);

  return (
    <div className="ov">
      <Section title="O QUE ACONTECEU" id="ov-resumo">
        {!doc && <p className="t3">CARREGANDO caso.md ...</p>}
        {doc && !doc.ok && (
          <p className="red">
            ERRO {doc.err}
          </p>
        )}
        {doc?.ok && !resumoParas && (
          <p className="ov-empty">
            <span className="lbl">RESUMO AINDA NÃO ESCRITO</span> <span className="t3">▮</span>{' '}
            <span className="t2">peça ao Claude ou ao Codex: "escreva o resumo do caso"</span>
          </p>
        )}
        {resumoParas && (
          <>
            <div className="ov-narr">
              {resumoParas.map((p, i) => (
                <p key={i}>
                  <Inline text={p} />
                </p>
              ))}
            </div>
            <p className="ov-legend t2">
              <span className="stamp stamp-evid">■</span> comprovado nos registros · <span className="stamp stamp-hip">◇</span> suposição ainda não
              comprovada · <span className="stamp stamp-lim hatch">⊘</span> não temos dados para saber
            </p>
          </>
        )}
      </Section>

      <Section title="FASES DO ATAQUE" id="ov-fases">
        {!evs && <p className="t3">CARREGANDO eventos ...</p>}
        {evs && !evs.ok && <p className="red">ERRO {evs.err}</p>}
        {fases && (
          <>
            <ol className="kc">
              {fases.map((f) => (
                <li key={f.tatica} className={`kc-cell${f.eventos ? '' : ' is-off'}`}>
                  <button
                    type="button"
                    className="kc-btn"
                    disabled={!f.eventos}
                    onClick={() => onTatica(f.tatica)}
                    title={f.eventos ? `${f.tatica}: abrir a timeline só com estes eventos` : `${f.tatica}: não observado`}
                  >
                    <span className="lbl kc-lbl">{f.rotulo}</span>
                    {f.eventos ? (
                      <>
                        <span className="kc-ts">{f.primeiro ? f.primeiro.slice(11, 19) : ''}</span>
                        <span className="t2">
                          {f.eventos} {f.eventos === 1 ? 'evento' : 'eventos'}
                        </span>
                        {f.tecnicas.slice(0, 2).map((t) => (
                          <span key={t.id} className="kc-tech" title={t.id}>
                            {tecnicaPt(t.id)}
                          </span>
                        ))}
                        {f.tecnicas.length > 2 && <span className="t3">+{f.tecnicas.length - 2}</span>}
                        {f.sugerido && <span className="lbl amber kc-sug">sugerido</span>}
                      </>
                    ) : (
                      <span className="t3">não observado</span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
            <p className="t3 ov-note">
              ordem típica de um ataque, da entrada à saída de dados · clique numa fase para ver os eventos · "sugerido" = técnica atribuída por regra
              automática, ainda não confirmada por analista
            </p>
          </>
        )}
      </Section>

      <div className="ov-cols">
        <Section title="QUEM E O QUE FOI AFETADO" id="ov-afetados">
          <dl className="ov-dl">
            <dt className="lbl t2">MÁQUINAS</dt>
            <dd>
              {top('host').map(([h, info]) => (
                <span key={h} className="ov-item">
                  <button type="button" className="pivot" onClick={() => onPivot('host', h)}>
                    {h}
                  </button>
                  <span className="t3"> ({info.eventos})</span>
                  {semEdr.has(h) && (
                    <span className="stamp stamp-bad" title="sem antivírus avançado (EDR): atividade nesta máquina pode não ter sido registrada">
                      sem EDR
                    </span>
                  )}
                </span>
              ))}
              {entidades && top('host').length === 0 && <span className="t3">nenhuma</span>}
            </dd>
            <dt className="lbl t2">CONTAS</dt>
            <dd>
              {top('user').map(([u, info]) => (
                <span key={u} className="ov-item">
                  <button type="button" className="pivot" onClick={() => onPivot('user', u)}>
                    {u}
                  </button>
                  <span className="t3"> ({info.eventos})</span>
                </span>
              ))}
            </dd>
            <dt className="lbl t2">IPS EXTERNOS</dt>
            <dd>
              {ext('ip').map((c) => (
                <span key={c.valor} className="ov-item" title={c.contexto}>
                  <button type="button" className="pivot" onClick={() => onPivot('ip', c.valor)}>
                    {c.valor}
                  </button>
                </span>
              ))}
              {iocs?.ok && ext('ip').length === 0 && <span className="t3">nenhum</span>}
            </dd>
            <dt className="lbl t2">DOMÍNIOS EXTERNOS</dt>
            <dd>
              {ext('dominio').map((c) => (
                <span key={c.valor} className="ov-item" title={c.contexto}>
                  <button type="button" className="pivot" onClick={() => onPivot('dominio', c.valor)}>
                    {c.valor}
                  </button>
                </span>
              ))}
              {iocs?.ok && ext('dominio').length === 0 && <span className="t3">nenhum</span>}
            </dd>
          </dl>
          {iocs && !iocs.ok && <p className="red">ERRO iocs: {iocs.err}</p>}
        </Section>

        <Section title="DÁ PARA CONFIAR NOS DADOS?" id="ov-confianca">
          {!resumo && <p className="t3">CARREGANDO /resumo ...</p>}
          {resumo && (
            <dl className="ov-dl">
              <dt className="lbl t2">CUSTÓDIA</dt>
              <dd>
                {resumo.custodia.integra ? (
                  <span className="green">✓ íntegra — as {resumo.custodia.arquivos} evidências conferem com o SHA-256 da coleta</span>
                ) : (
                  <span className="red">✕ {resumo.custodia.problemas.length} problema(s): {resumo.custodia.problemas.join('; ')}</span>
                )}
              </dd>
              <dt className="lbl t2">FONTES</dt>
              <dd>
                <span>{Object.keys(resumo.por_fonte).length} fontes de dados; cada uma cobre só a janela abaixo:</span>
                <ul className="ov-src">
                  {Object.entries(resumo.por_fonte)
                    .sort((a, b) => tsMs(a[1].primeiro) - tsMs(b[1].primeiro))
                    .map(([s, f]) => (
                      <li key={s}>
                        <span className="ov-src-name" style={{ color: sourceColor(s) }}>
                          {sourceLong(s)}
                        </span>
                        <span>
                          {hhmm(tsMs(f.primeiro))}–{hhmm(tsMs(f.ultimo))}
                        </span>
                        <span className="t3"> {f.eventos} evt</span>
                      </li>
                    ))}
                </ul>
              </dd>
              <dt className="lbl t2">SEM EDR</dt>
              <dd>
                {resumo.hosts_sem_edr.length ? (
                  <span className="red">
                    {resumo.hosts_sem_edr.join(', ')} <span className="t2">— o que aconteceu nelas pode não ter sido registrado</span>
                  </span>
                ) : (
                  <span className="green">todas as máquinas têm EDR</span>
                )}
              </dd>
              <dt className="lbl t2">LIMITAÇÕES</dt>
              <dd>
                <span className="stamp stamp-lim hatch">⊘{resumo.contagens.limitacoes}</span>{' '}
                <button type="button" className="pivot" onClick={onCobertura}>
                  ver F5 COBERTURA
                </button>
              </dd>
              <dt className="lbl t2">HIPÓTESES</dt>
              <dd>
                {hip?.ok ? (
                  <span>
                    {abertas.length} aberta(s) de {hip.v.length} — ainda há perguntas sem resposta
                  </span>
                ) : hip && !hip.ok ? (
                  <span className="red">ERRO {hip.err}</span>
                ) : (
                  <span className="t3">CARREGANDO ...</span>
                )}
              </dd>
            </dl>
          )}
        </Section>
      </div>

      <Section title="PRÓXIMOS PASSOS" id="ov-passos">
        {!hip && <p className="t3">CARREGANDO hipoteses.md ...</p>}
        {hip?.ok && abertas.length === 0 && <p className="t2">nenhuma hipótese aberta</p>}
        {abertas.length > 0 && (
          <ul className="ov-steps">
            {abertas.map((h) => (
              <li key={h.id}>
                <span className="stamp stamp-hip">
                  ◇{h.id}
                  {h.confianca ? `·${h.confianca.toUpperCase().slice(0, 3)}` : ''}
                </span>{' '}
                <span>{h.titulo}</span> <span className="amber">→</span>{' '}
                {h.proximo_passo ? <span>{h.proximo_passo}</span> : <span className="t3">definir próximo passo</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
