// F4 IOC (/iocs): candidatos e registrados em tabelas separadas.
// Defanged por padrão (hxxps://, [.], [@]); D alterna. y copia o valor REAL da linha;
// Y copia todos os visíveis defanged, um por linha. Enter/p pivô na timeline.
// Aprovar/descartar: placeholder visível (bancada, entrega E3).
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
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

export const Ioc = forwardRef<ViewHandle, Props>(function Ioc({ caso, modo, onPivot, onMsg, onPrompt }, ref) {
  const guiado = modo === 'guiado';
  const data = useLoad(() => api.iocs(caso), [caso]);
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

  const bancada = (acao: string) => onMsg(`${acao}: bancada de IOCs é a entrega E3 (ainda só leitura)`, 'info');

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
                <td className={String(r.confianca ?? '') === 'candidato' ? 'amber' : ''}>{String(r.confianca ?? r.status ?? '—')}</td>
                <td className="ioc-act">
                  <button type="button" className="btn-stamp btn-off" onClick={() => bancada('aprovar')} title="bancada: entrega E3">
                    aprovar
                  </button>{' '}
                  <button type="button" className="btn-stamp btn-off" onClick={() => bancada('descartar')} title="bancada: entrega E3">
                    descartar
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
            ? 'indicadores de comprometimento: endereços, domínios e arquivos ligados ao ataque · D mostra/oculta o valor real · y copia o real · Y copia todos (defanged) · ↵ pivô'
            : 'D defang · y copia real · Y copia visíveis defanged · ↵ pivô · / filtra'}
        </span>
      </div>
      {!data && <p className="inline-state t3">CARREGANDO /iocs ...</p>}
      {data && !data.ok && <p className="inline-state red">ERRO {data.err}</p>}
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
