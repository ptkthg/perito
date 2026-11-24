// F5 COBERTURA (brief §4): matriz fonte × tempo (lacunas hachuradas), lacunas com
// [l] registrar LIM (formulário inline pré-preenchido), matriz fonte × host com
// hosts sem EDR em vermelho com ⊘, e a zona INGERIR abaixo.
import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import type { Resumo } from '../../lib/types';
import type { Modo } from '../../lib/mode';
import type { ViewHandle } from '../../lib/view';
import { useLoad } from '../../lib/useLoad';
import { SOURCE_ORDER, hhmm, sourceCode, sourceColor } from '../../lib/format';
import { CATEGORIAS, type Lacuna, lacunas, matrizHost, matrizTempo, prefillLacuna } from '../../lib/cobertura';
import { LimForm } from '../bench/LimForm';
import type { MsgKind } from '../../lib/msg';

interface Props {
  caso: string;
  modo: Modo;
  rev: number;
  resumo: Resumo | null;
  ingest: React.ReactNode;
  onMsg(text: string, kind?: MsgKind): void;
  onEscrito(msg: string): void;
}

export const Coverage = forwardRef<ViewHandle, Props>(function Coverage({ caso, modo, rev, resumo, ingest, onMsg, onEscrito }, ref) {
  const guiado = modo === 'guiado';
  const hist = useLoad(() => api.histograma(caso, {}), [caso, rev]);
  const evs = useLoad(() => api.eventos(caso, {}), [caso, rev]);
  const [sel, setSel] = useState(0);
  const [form, setForm] = useState<Lacuna | null>(null);

  const fontes = useMemo(() => {
    if (!hist?.ok) return [];
    const pres = new Set([...Object.keys(hist.v.fontes), ...Object.keys(hist.v.cobertura)]);
    return [...SOURCE_ORDER.filter((s) => pres.has(s)), ...[...pres].filter((s) => !SOURCE_ORDER.includes(s)).sort()];
  }, [hist]);
  const mt = useMemo(() => (hist?.ok ? matrizTempo(hist.v, fontes, 24) : null), [hist, fontes]);
  const lac = useMemo(() => (hist?.ok ? lacunas(hist.v, resumo?.hosts_sem_edr ?? []) : []), [hist, resumo]);
  const mh = useMemo(() => (evs?.ok ? matrizHost(evs.v.eventos) : []), [evs]);
  const semEdr = new Set(resumo?.hosts_sem_edr ?? []);

  useImperativeHandle(ref, () => ({
    onKey(e) {
      if (e.key === 'j' || e.key === 'ArrowDown') {
        setSel((s) => Math.min(lac.length - 1, s + 1));
        return true;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        setSel((s) => Math.max(0, s - 1));
        return true;
      }
      if (e.key === 'l' || e.key === 'Enter') {
        const l = lac[sel];
        if (l) setForm(l);
        return true;
      }
      return false;
    },
    escape() {
      if (form) {
        setForm(null);
        return true;
      }
      return false;
    },
  }));

  return (
    <div className="cob">
      <div className="doc-bar">
        <span className="lbl">F5 COBERTURA</span> <span className="t3">▮</span>{' '}
        <span>{fontes.length} fontes</span> · <span className={semEdr.size ? 'red' : 'green'}>{semEdr.size} host(s) sem EDR</span> ·{' '}
        <span className="amber">{lac.length} lacuna(s)</span>
        <span className="t3"> · j/k lacuna · [l] registrar LIM · [i] ingerir</span>
        {guiado && <span className="t2"> · "não houve evento" é diferente de "não havia coleta": a hachura mostra onde não havia coleta</span>}
      </div>

      <section className="ov-sec" aria-labelledby="cob-tempo">
        <h2 id="cob-tempo" className="lbl ov-h">
          FONTE × TEMPO <span className="t3">(eventos por intervalo; ░ = sem coleta)</span>
        </h2>
        {!mt && <p className="t3">CARREGANDO /histograma ...</p>}
        {mt && (
          <div className="cob-scroll">
            <table className="cob-tab cob-tempo">
              <thead>
                <tr>
                  <th className="lbl">FONTE</th>
                  {mt.cols.map((c, i) => (
                    <th key={i} className="t3 num-data">
                      {i % 3 === 0 ? hhmm(c.ini) : ''}
                    </th>
                  ))}
                  <th className="lbl">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {mt.linhas.map((l) => (
                  <tr key={l.fonte}>
                    <th style={{ color: sourceColor(l.fonte) }} title={l.fonte}>
                      {sourceCode(l.fonte)}
                    </th>
                    {l.celulas.map((c, i) => (
                      <td
                        key={i}
                        className={`cob-b num-data${c.lacuna ? ' is-gap' : c.n ? ' is-on' : ' t3'}`}
                        title={`${l.fonte} ${hhmm(mt.cols[i]!.ini)}–${hhmm(mt.cols[i]!.fim)}: ${c.lacuna ? 'sem coleta' : `${c.n} evento(s)`}`}
                      >
                        {c.lacuna ? '' : c.n ? (c.n > 99 ? '99+' : c.n) : '·'}
                      </td>
                    ))}
                    <td className="num-data">{l.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ov-sec" aria-labelledby="cob-lac">
        <h2 id="cob-lac" className="lbl ov-h">
          LACUNAS <span className="t3">(cada uma pode virar ⊘LIM em limitacoes.md)</span>
        </h2>
        {lac.length === 0 && hist?.ok && <p className="t2">nenhuma lacuna de coleta detectada</p>}
        <ul className="cob-lacunas">
          {lac.map((l, i) => (
            <li key={l.id} className={i === sel ? 'is-sel' : ''} onClick={() => setSel(i)}>
              <span className="selbar">{i === sel ? '▌' : ' '}</span>
              <span className="stamp stamp-lim hatch">⊘</span> <span className={l.tipo === 'edr' ? 'red' : ''}>{l.texto}</span>{' '}
              <button type="button" className="btn-stamp" onClick={() => setForm(l)}>
                [l] registrar LIM
              </button>
              {form?.id === l.id && (
                <LimForm
                  caso={caso}
                  modo={modo}
                  prefill={prefillLacuna(l)}
                  onMsg={onMsg}
                  onFechar={() => setForm(null)}
                  onSalvo={(m) => {
                    setForm(null);
                    onEscrito(m);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="ov-sec" aria-labelledby="cob-host">
        <h2 id="cob-host" className="lbl ov-h">
          FONTE × HOST <span className="t3">(eventos por tipo de telemetria)</span>
        </h2>
        {!evs && <p className="t3">CARREGANDO eventos ...</p>}
        {mh.length > 0 && (
          <table className="cob-tab">
            <thead>
              <tr>
                <th className="lbl">HOST</th>
                {CATEGORIAS.map((c) => (
                  <th key={c.k} className="lbl" title={c.ajuda}>
                    {c.rot}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mh.map((r) => {
                const sem = semEdr.has(r.host);
                return (
                  <tr key={r.host}>
                    <th className={sem ? 'red' : ''}>
                      {sem && '⊘ '}
                      {r.host}
                    </th>
                    {CATEGORIAS.map((c) => {
                      const n = r.c[c.k];
                      return (
                        <td key={c.k} className={n ? 'green' : c.k === 'edr' ? 'red hatch' : 't3'}>
                          {n ? `✓ ${n}` : c.k === 'edr' ? '⊘ sem EDR' : '—'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {guiado && <p className="bench-help t2">{CATEGORIAS.map((c) => `${c.rot}: ${c.ajuda}`).join(' · ')}</p>}
      </section>

      <section className="ov-sec" aria-labelledby="cob-ing">
        <h2 id="cob-ing" className="lbl ov-h">
          INGERIR
        </h2>
        {ingest}
      </section>
    </div>
  );
});
