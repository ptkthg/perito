// F4 IOC (/iocs): candidatos e registrados em tabelas separadas.
// Defanged por padrão (hxxps://, [.], [@]); D alterna. y copia o valor REAL da linha;
// Y copia todos os visíveis defanged, um por linha. Enter/p pivô na timeline.
// Aprovar/descartar: placeholder visível (bancada, entrega E3).
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ApiError, ConflitoError, api, describeError } from '../../lib/api';
import { MOTIVOS, type Confianca, loteIoc } from '../../lib/bancada';
import { ConflictPanel } from '../bench/ConflictPanel';
import type { IocCandidato } from '../../lib/types';
import type { FilterField } from '../../lib/filters';
import type { Modo } from '../../lib/mode';
import { type ViewHandle, moveKey } from '../../lib/view';
import { useLoad } from '../../lib/useLoad';
import { defang } from '../../lib/ioc';
import { copyText } from '../../lib/clipboard';
import { resolveSource, sourceCode, sourceColor, truncateMiddle } from '../../lib/format';
import type { PromptMode } from '../../components/CommandLine';
import type { MsgKind } from '../timeline/Timeline';

interface Props {
  caso: string;
  modo: Modo;
  onPivot(field: FilterField, value: string): void;
  onMsg(text: string, kind?: MsgKind): void;
  onPrompt(prefill: string, mode: PromptMode): void;
  rev: number;
  onEscrito(msg: string): void;
}

interface Descarte {
  alvos: Linha[];
  motivo: string | null;
  outro: string;
  erro: string | null;
}

const TIPO_PT: Record<string, string> = {
  ip: 'IP',
  dominio: 'domínio',
  url: 'URL',
  email: 'e-mail',
  sha256: 'hash',
  arquivo: 'arquivo',
};

/** Campo de pivô por tipo de IOC (arquivo/e-mail caem em busca de texto). */
function pivotField(tipo: string): FilterField {
  switch (tipo) {
    case 'ip':
      return 'ip';
    case 'dominio':
      return 'dominio';
    case 'sha256':
      return 'hash';
    default:
      return 'texto';
  }
}

type Linha = { r: Record<string, unknown>; tipo: string; valor: string };

const toLinha = (c: IocCandidato | Record<string, string>): Linha => ({
  r: c as Record<string, unknown>,
  tipo: String(c.tipo ?? ''),
  valor: String(c.valor ?? ''),
});

export const Ioc = forwardRef<ViewHandle, Props>(function Ioc({ caso, modo, onPivot, onMsg, onPrompt, rev, onEscrito }, ref) {
  const guiado = modo === 'guiado';
  const data = useLoad(() => api.iocs(caso), [caso, rev]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [descarte, setDescarte] = useState<Descarte | null>(null);
  const [conflito, setConflito] = useState<{ atual: string; refazer: () => void } | null>(null);
  const [gravando, setGravando] = useState(false);
  const outroRef = useRef<HTMLInputElement>(null);
  const [defanged, setDefanged] = useState(true);
  const [busca, setBusca] = useState('');
  const [col, setCol] = useState(0);
  const [rows, setRows] = useState([0, 0]);
  const rootRef = useRef<HTMLDivElement>(null);

  const t = busca.toLowerCase();
  const filtra = (xs: Linha[]) => xs.filter((l) => !t || Object.values(l.r).join(' ').toLowerCase().includes(t));
  const cand = useMemo(() => (data?.ok ? filtra(data.v.candidatos.map(toLinha)) : []), [data, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const reg = useMemo(() => (data?.ok ? filtra(data.v.registrados.map(toLinha)) : []), [data, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const listas = [cand, reg];
  const sel = listas[col]?.[rows[col] ?? 0] ?? null;

  const show = (l: Linha) => (defanged ? defang(l.valor, l.tipo) : l.valor);

  const setPos = (c: number, r: number, focus = true) => {
    setCol(c);
    setRows((rs) => rs.map((x, i) => (i === c ? r : x)));
    if (focus)
      requestAnimationFrame(() => {
        const el = rootRef.current?.querySelector<HTMLElement>(`[data-ioc="${c}:${r}"]`);
        (el ?? rootRef.current)?.focus();
      });
  };

  const chave = (l: { tipo: string; valor: string }) => `${l.tipo}\u0000${l.valor}`;
  const registrados = useMemo(() => new Map(reg.map((l) => [chave(l), String(l.r.confianca ?? '')])), [reg]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Alvos da ação: as linhas marcadas (m) ou, sem marcas, a linha selecionada. */
  const alvos = (): Linha[] => {
    const todos = [...cand, ...reg];
    const m = todos.filter((l) => marcados.has(chave(l)));
    return m.length ? m : sel ? [sel] : [];
  };

  /** Registra candidatos ainda fora do iocs.csv (POST) e muda a confiança em lote (PATCH itens[]). */
  const aplicar = async (linhas: Linha[], confianca: Confianca, motivo?: string) => {
    let lote;
    try {
      lote = loteIoc(linhas, confianca, motivo);
    } catch (x) {
      onMsg(`✕ ${(x as Error).message}`, 'err');
      return false;
    }
    setGravando(true);
    const fazer = async (): Promise<boolean> => {
      try {
        for (const l of linhas) {
          if (registrados.has(chave(l))) continue;
          const r = l.r;
          const corpo: Record<string, string> = { tipo: l.tipo, valor: l.valor, confianca: 'candidato' };
          for (const k of ['primeira_vez_utc', 'ultima_vez_utc', 'fonte', 'contexto']) if (r[k]) corpo[k] = String(r[k]);
          await api.criarIoc(caso, corpo);
        }
        await api.patchIoc(caso, lote.itens.length === 1 ? { ...lote.itens[0] } : lote);
        setConflito(null);
        setMarcados(new Set());
        const n = lote.itens.length;
        onEscrito(`✓ ${n} IOC${n > 1 ? 's' : ''} ${confianca === 'confirmado' ? `aprovado${n > 1 ? 's' : ''}` : `descartado${n > 1 ? 's' : ''} (${motivo})`} → iocs.csv`);
        return true;
      } catch (x) {
        if (x instanceof ConflitoError) {
          setConflito({ atual: x.conflito.conteudoAtual, refazer: () => void api.iocs(caso).then(() => fazer()) });
        } else {
          const m = x instanceof ApiError ? `${x.message}${x.detalhe ? ` — ${x.detalhe}` : ''}` : describeError(x);
          onMsg(`✕ IOC não gravado: ${m}`, 'err');
        }
        return false;
      } finally {
        setGravando(false);
      }
    };
    return fazer();
  };

  const abrirDescarte = () => {
    const a = alvos();
    if (!a.length) return;
    setDescarte({ alvos: a, motivo: null, outro: '', erro: null });
  };

  const confirmarDescarte = () => {
    if (!descarte) return;
    let motivo = descarte.motivo;
    if (motivo === 'outro') motivo = `outro: ${descarte.outro.trim()}`;
    if (!motivo || motivo === 'outro: ') {
      setDescarte({ ...descarte, erro: 'motivo obrigatório: escolha [1]–[4]' });
      return;
    }
    void aplicar(descarte.alvos, 'descartado', motivo).then((ok) => ok && setDescarte(null));
  };

  const bancada = (acao: 'aprovar' | 'descartar', l: Linha) => {
    if (acao === 'aprovar') void aplicar(marcados.size ? alvos() : [l], 'confirmado');
    else setDescarte({ alvos: marcados.size ? alvos() : [l], motivo: null, outro: '', erro: null });
  };

  useImperativeHandle(ref, () => ({
    onKey(e) {
      // j no fim dos candidatos desce para os registrados; k no topo dos registrados sobe.
      const r0 = rows[col] ?? 0;
      if ((e.key === 'j' || e.key === 'ArrowDown') && col === 0 && r0 >= cand.length - 1 && reg.length > 0) {
        setPos(1, 0);
        return true;
      }
      if ((e.key === 'k' || e.key === 'ArrowUp') && col === 1 && r0 === 0 && cand.length > 0) {
        setPos(0, cand.length - 1);
        return true;
      }
      const mv = e.key === 'h' || e.key === 'l' ? null : moveKey(e.key, col, r0, 2, (c) => listas[c]?.length ?? 0);
      if (mv) {
        setPos(mv.col, mv.row);
        return true;
      }
      switch (e.key) {
        case 'a':
          if (!gravando) void aplicar(alvos(), 'confirmado');
          return true;
        case 'd':
          abrirDescarte();
          return true;
        case 'm':
          if (sel) {
            const k = chave(sel);
            const n = new Set(marcados);
            if (n.has(k)) n.delete(k);
            else n.add(k);
            setMarcados(n);
            onMsg(`${n.size} IOC(s) marcado(s) para lote · a aprova · d descarta`, 'info');
          }
          return true;
        case 'D':
          setDefanged(!defanged);
          onMsg(defanged ? 'exibindo valores REAIS (D volta ao defanged)' : 'exibindo defanged (hxxp, [.], [@])', defanged ? 'err' : 'ok');
          return true;
        case 'y':
          if (sel) void copyText(sel.valor).then((ok) => onMsg(ok ? `copiado (valor real): ${sel.valor}` : 'falha ao copiar', ok ? 'ok' : 'err'));
          return true;
        case 'Y': {
          const todos = listas[col] ?? [];
          const txt = todos.map((l) => defang(l.valor, l.tipo)).join('\n');
          void copyText(txt).then((ok) => onMsg(ok ? `copiados ${todos.length} IOCs defanged (um por linha)` : 'falha ao copiar', ok ? 'ok' : 'err'));
          return true;
        }
        case 'Enter':
        case 'p':
          if (sel) onPivot(pivotField(sel.tipo), sel.valor);
          return true;
        case '/':
          onPrompt('', 'search');
          return true;
        default:
          return false;
      }
    },
    search: (s) => setBusca(s),
    searchCommit: (s) => {
      setBusca(s);
      setRows([0, 0]);
    },
    searchCancel: () => setBusca(''),
    escape() {
      if (descarte) {
        setDescarte(null);
        return true;
      }
      if (marcados.size) {
        setMarcados(new Set());
        onMsg('marcas de lote limpas', 'info');
        return true;
      }
      if (!busca) return false;
      setBusca('');
      return true;
    },
    focus: () => setPos(col, rows[col] ?? 0),
  }));

  const fontes = (f: unknown) =>
    String(f ?? '')
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => resolveSource(x));

  const tabela = (lista: Linha[], c: number, vazio: React.ReactNode) =>
    lista.length === 0 ? (
      <p className="inline-state">{vazio}</p>
    ) : (
      <table className="ioc">
        <thead>
          <tr className="lbl t2">
            <th>TIPO</th>
            <th>VALOR {defanged ? <span className="t3">(defanged)</span> : <span className="red">(REAL)</span>}</th>
            <th>{guiado ? 'PRIMEIRA VEZ' : '1ª VEZ'}</th>
            <th>{guiado ? 'ÚLTIMA VEZ' : 'ÚLTIMA'}</th>
            <th>{guiado ? 'FONTES' : 'SRC'}</th>
            <th>CONTEXTO</th>
            <th>{guiado ? 'SITUAÇÃO' : 'CONF'}</th>
            <th>{guiado ? 'BANCADA' : ''}</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((l, ri) => {
            const isSel = col === c && ri === (rows[c] ?? 0);
            const r = l.r;
            const pv = String(r.primeira_vez_utc ?? '');
            const uv = String(r.ultima_vez_utc ?? '');
            return (
              <tr key={`${l.tipo}:${l.valor}`} className={isSel ? 'is-sel' : ''} data-ioc={`${c}:${ri}`} tabIndex={isSel ? 0 : -1} onClick={() => setPos(c, ri, false)}>
                <td className="t2">{guiado ? (TIPO_PT[l.tipo] ?? l.tipo) : l.tipo}</td>
                <td className="ioc-v">
                  <span className="selbar" aria-hidden>
                    {isSel ? '▌' : ' '}
                  </span>
                  <span className="amber ioc-mark" aria-label={marcados.has(chave(l)) ? 'marcado para lote' : undefined}>
                    {marcados.has(chave(l)) ? '*' : ' '}
                  </span>
                  <button
                    type="button"
                    className="pivot"
                    onClick={() => onPivot(pivotField(l.tipo), l.valor)}
                    title={`${show(l)} · pivô na timeline (${pivotField(l.tipo)}) · y copia o valor real`}
                  >
                    {truncateMiddle(show(l), 56)}
                  </button>
                </td>
                <td className="num-data">{pv ? pv.slice(11, 19) : '—'}</td>
                <td className="num-data">{uv ? uv.slice(11, 19) : '—'}</td>
                <td>
                  {fontes(r.fonte).map((f) => (
                    <span key={f} className="ioc-src" style={{ color: sourceColor(f) }} title={f}>
                      {sourceCode(f)}
                    </span>
                  ))}
                </td>
                <td className="ioc-ctx ellip" title={String(r.contexto ?? '')}>
                  {String(r.contexto ?? '')}
                </td>
                {(() => {
                  const regc = c === 0 ? registrados.get(chave(l)) : String(r.confianca ?? '');
                  const v = regc || String(r.confianca ?? r.status ?? '—');
                  return <td className={`ioc-st ioc-st-${v}`}>{v}</td>;
                })()}
                <td className="ioc-act">
                  <button type="button" className="btn-stamp" onClick={() => bancada('aprovar', l)} title="a: aprova (iocs.csv, confirmado)">
                    {guiado ? 'aprovar' : 'a'}
                  </button>{' '}
                  <button type="button" className="btn-stamp" onClick={() => bancada('descartar', l)} title="d: descarta com motivo">
                    {guiado ? 'descartar' : 'd'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );

  return (
    <div className="iocv" ref={rootRef} tabIndex={-1}>
      <div className="strip">
        <span className="lbl t2">IOC</span>
        <span className={defanged ? 'green' : 'red'}>{defanged ? 'DEFANGED' : 'VALORES REAIS'}</span>
        {busca && <span className="amber">/{busca}</span>}
        <span className="strip-clauses t3">
          {guiado
            ? 'indicadores de comprometimento: endereços, domínios e arquivos ligados ao ataque · a aprova · d descarta · m marca para lote · D mostra/oculta o valor real · y copia · Y copia todos (defanged) · ↵ pivô'
            : 'a aprova · d descarta · m lote · D defang · y copia real · Y visíveis defanged · ↵ pivô · / filtra'}
        </span>
      </div>
      {!data && <p className="inline-state t3">CARREGANDO /iocs ...</p>}
      {data && !data.ok && <p className="inline-state red">ERRO {data.err}</p>}
      {conflito && (
        <ConflictPanel arquivo="iocs.csv" base={null} atual={conflito.atual} modo={modo} onRecarregar={conflito.refazer} onManter={() => setConflito(null)} />
      )}
      {descarte && (
        <div
          className="bench ioc-desc"
          role="group"
          aria-label="Descartar IOC"
          onKeyDown={(e) => {
            if (/^F\d$/.test(e.key)) return;
            e.stopPropagation();
            const inp = e.target instanceof HTMLInputElement;
            if (e.key === 'Escape') {
              e.preventDefault();
              setDescarte(null);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              confirmarDescarte();
            } else if (!inp && /^[1-4]$/.test(e.key)) {
              e.preventDefault();
              const m = e.key === '4' ? 'outro' : MOTIVOS[Number(e.key) - 1]!;
              setDescarte({ ...descarte, motivo: m, erro: null });
              if (m === 'outro') requestAnimationFrame(() => outroRef.current?.focus());
            }
          }}
          ref={(el) => {
            if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('button')?.focus();
          }}
        >
          <p className="bench-h">
            <span className="lbl">DESCARTAR {descarte.alvos.length} IOC{descarte.alvos.length > 1 ? 'S' : ''}</span>{' '}
            <span className="t3">{descarte.alvos.map((a) => defang(a.valor, a.tipo)).join(' · ').slice(0, 120)}</span>
          </p>
          {guiado && <p className="bench-help t2">O motivo vai para o contexto do IOC em iocs.csv. Escolha um ([1]–[4]) e confirme com Enter.</p>}
          <div className="chips" role="radiogroup" aria-label="Motivo do descarte">
            {[...MOTIVOS, 'outro'].map((m, i) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={descarte.motivo === m}
                className={`chip${descarte.motivo === m ? ' is-on' : ''}`}
                onClick={() => {
                  setDescarte({ ...descarte, motivo: m, erro: null });
                  if (m === 'outro') requestAnimationFrame(() => outroRef.current?.focus());
                }}
              >
                [{i + 1}] {m}
                {m === 'outro' ? ':' : ''}
              </button>
            ))}
            {descarte.motivo === 'outro' && (
              <input
                ref={outroRef}
                className="bench-in ioc-outro"
                maxLength={200}
                value={descarte.outro}
                placeholder="descreva (até 200)"
                onChange={(e) => setDescarte({ ...descarte, outro: e.target.value, erro: null })}
              />
            )}
          </div>
          {descarte.erro && (
            <p className="red bench-err" role="alert">
              ✕ {descarte.erro}
            </p>
          )}
          <p className="bench-actions">
            <button type="button" className="btn-stamp btn-main" onClick={confirmarDescarte}>
              {guiado ? 'Descartar (Enter)' : 'Enter descarta'}
            </button>{' '}
            <button type="button" className="btn-stamp" onClick={() => setDescarte(null)}>
              {guiado ? 'Cancelar (Esc)' : 'Esc'}
            </button>
          </p>
        </div>
      )}
      {data?.ok && (
        <div className="ioc-body">
          <section aria-labelledby="ioc-c">
            <h2 id="ioc-c" className={`lbl ov-h${col === 0 ? ' amber' : ''}`}>
              CANDIDATOS <span className="t3 num-data">{cand.length}</span>
              {guiado && <span className="t2 ioc-sub"> · extraídos automaticamente dos eventos; precisam de revisão</span>}
            </h2>
            {tabela(cand, 0, <span className="t3">nenhum candidato{busca ? ` para /${busca}` : ''}</span>)}
          </section>
          <section aria-labelledby="ioc-r">
            <h2 id="ioc-r" className={`lbl ov-h${col === 1 ? ' amber' : ''}`}>
              REGISTRADOS (iocs.csv) <span className="t3 num-data">{reg.length}</span>
            </h2>
            {tabela(
              reg,
              1,
              <>
                <span className="lbl">NENHUM IOC REGISTRADO</span> <span className="t3">▮</span>{' '}
                <span className="t2">aprove candidatos na bancada (entrega E3)</span>
              </>,
            )}
          </section>
        </div>
      )}
    </div>
  );
});
