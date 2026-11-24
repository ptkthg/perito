// INGERIR (brief §10): arrastar e soltar ou [i] escolher arquivos; atômica por arquivo.
//   ociosa      ┌╌ INGERIR ╌╌┐ solte exportações aqui ou [i] escolher arquivos
//   arrastando  borda 2px âmbar · "SOLTE PARA INGERIR 3 ITENS"
//   enviando    INGERINDO 2/3 defender.csv ▮▮▮▮▮▮▯▯▯▯ 61% 412/680 MB 00:00:14  (fila ✓ ▸ ·)
//   resultado   ARQUIVO  FONTE  EVENTOS  AVISOS  SHA-256
//   erro        ✕ E-FORMATO arquivo · nada deste arquivo foi gravado · [r] tentar de novo
// Um arquivo por requisição (octet-stream + X-Perito-Arquivo); progresso por XHR upload.onprogress.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ApiError, type Formato, type IngestaoResult, api, describeError } from '../lib/api';
import type { Modo } from '../lib/mode';
import { formatBytes, sourceCode, sourceColor } from '../lib/format';
import type { MsgKind } from '../lib/msg';

export interface IngestHandle {
  escolher(): void;
}

interface Props {
  caso: string;
  modo: Modo;
  /** Chamado ao fim da fila com pelo menos um sucesso: o shell recarrega tudo. */
  onConcluido(n: number): void;
  onMsg(text: string, kind?: MsgKind): void;
}

type Estado = 'fila' | 'enviando' | 'ok' | 'erro';
interface Item {
  id: number;
  file: File;
  estado: Estado;
  enviados: number;
  t0: number;
  t1: number;
  res?: IngestaoResult;
  erro?: string;
}

let seqId = 0;

const barra = (p: number, n = 10) => '▮'.repeat(Math.round(p * n)).padEnd(n, '▯');
const relogio = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const Ingest = forwardRef<IngestHandle, Props>(function Ingest({ caso, modo, onConcluido, onMsg }, ref) {
  const guiado = modo === 'guiado';
  const [itens, setItens] = useState<Item[]>([]);
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [formatos, setFormatos] = useState<Formato[]>([]);
  const [fonte, setFonte] = useState('auto');
  const [obs, setObs] = useState('');
  const [agora, setAgora] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rodando = useRef(false);
  const itensRef = useRef(itens);
  itensRef.current = itens;

  useImperativeHandle(ref, () => ({ escolher: () => inputRef.current?.click() }));

  useEffect(() => {
    api
      .formatos()
      .then(setFormatos)
      .catch(() => setFormatos([{ fonte: 'auto', descricao: 'Detecção automática da fonte' }]));
  }, []);

  // Relógio só enquanto há envio (texto; nada anima além do cursor do prompt).
  const enviando = itens.some((i) => i.estado === 'enviando');
  useEffect(() => {
    if (!enviando) return;
    const t = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [enviando]);

  const atualiza = (id: number, p: Partial<Item>) => setItens((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const processar = async () => {
    if (rodando.current) return;
    rodando.current = true;
    let ok = 0;
    try {
      for (;;) {
        const prox = itensRef.current.find((x) => x.estado === 'fila');
        if (!prox) break;
        const t0 = Date.now();
        atualiza(prox.id, { estado: 'enviando', t0, enviados: 0 });
        setAgora(t0);
        try {
          const res = await api.ingerir(caso, prox.file, { fonte, obs }, (env) => atualiza(prox.id, { enviados: env }));
          atualiza(prox.id, { estado: 'ok', res, t1: Date.now(), enviados: prox.file.size });
          ok++;
        } catch (x) {
          const m = x instanceof ApiError ? `E-${x.status || 'REDE'} ${x.message}${x.detalhe ? ` — ${x.detalhe}` : ''}` : describeError(x);
          atualiza(prox.id, { estado: 'erro', erro: m, t1: Date.now() });
          onMsg(`✕ ${prox.file.name}: ${m} · nada deste arquivo foi gravado`, 'err');
        }
        // lê a fila atualizada no próximo ciclo
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      rodando.current = false;
    }
    if (ok > 0) {
      onMsg(`✓ INGERIDOS ${ok} arquivo(s) → evidencias/brutas + custodia.csv · timeline reconstruída`, 'ok');
      onConcluido(ok);
    }
  };

  const enfileirar = (files: FileList | File[]) => {
    const novos = [...files].map((file): Item => ({ id: ++seqId, file, estado: 'fila', enviados: 0, t0: 0, t1: 0 }));
    if (!novos.length) return;
    setItens((xs) => [...xs, ...novos]);
    itensRef.current = [...itensRef.current, ...novos];
    void processar();
  };

  const tentarDeNovo = (id: number) => {
    atualiza(id, { estado: 'fila', erro: undefined });
    itensRef.current = itensRef.current.map((x) => (x.id === id ? { ...x, estado: 'fila' } : x));
    void processar();
  };

  const atual = itens.find((i) => i.estado === 'enviando');
  const total = itens.length;
  const pos = atual ? itens.indexOf(atual) + 1 : 0;

  return (
    <section className="ingest" aria-label="Ingerir evidências">
      <div
        className={`ingest-zone${arrastando !== null ? ' is-drag' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setArrastando(e.dataTransfer.items?.length ?? 0);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (arrastando === null) setArrastando(e.dataTransfer.items?.length ?? 0);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(null);
          enfileirar(e.dataTransfer.files);
        }}
      >
        <span className="ingest-tag lbl">INGERIR</span>
        {arrastando !== null ? (
          <p className="amber lbl ingest-big">SOLTE PARA INGERIR {arrastando || ''} {arrastando === 1 ? 'ITEM' : 'ITENS'}</p>
        ) : (
          <p>
            solte exportações aqui ou{' '}
            <button type="button" className="btn-stamp" onClick={() => inputRef.current?.click()} aria-keyshortcuts="i">
              [i] escolher arquivos
            </button>
          </p>
        )}
        {guiado && arrastando === null && (
          <p className="bench-help t2">
            Cada arquivo é copiado para evidencias/brutas com SHA-256 na cadeia de custódia e entra na timeline. Formatos:{' '}
            {formatos
              .filter((f) => f.fonte !== 'auto')
              .map((f) => f.descricao)
              .join(' · ') || '…'}
          </p>
        )}
        <div className="ingest-opts">
          <label className="lbl t2" htmlFor="ing-fonte">
            FONTE
          </label>{' '}
          <select id="ing-fonte" className="bench-in ingest-sel" value={fonte} onChange={(e) => setFonte(e.target.value)}>
            {(formatos.length ? formatos : [{ fonte: 'auto', descricao: 'auto' }]).map((f) => (
              <option key={f.fonte} value={f.fonte} title={f.descricao}>
                {f.fonte}
              </option>
            ))}
          </select>{' '}
          <label className="lbl t2" htmlFor="ing-obs">
            OBS
          </label>{' '}
          <input id="ing-obs" className="bench-in ingest-obs" value={obs} maxLength={200} placeholder={guiado ? 'ex.: exportado pelo SOC em 10/11' : ''} onChange={(e) => setObs(e.target.value)} />
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          data-testid="ingest-input"
          onChange={(e) => {
            if (e.target.files) enfileirar(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {atual && (
        <p className="ingest-prog" aria-live="polite">
          <span className="lbl">INGERINDO</span> {pos}/{total} <span>{atual.file.name}</span>{' '}
          <span className="amber">{barra(atual.file.size ? atual.enviados / atual.file.size : 0)}</span>{' '}
          {Math.round(atual.file.size ? (atual.enviados / atual.file.size) * 100 : 0)}% {formatBytes(atual.enviados)}/{formatBytes(atual.file.size)}{' '}
          <span className="t3">{relogio((agora || atual.t0) - atual.t0)}</span>
          {atual.enviados >= atual.file.size && <span className="t2"> · processando no servidor</span>}
        </p>
      )}

      {itens.length > 0 && (
        <table className="ioc ingest-tab">
          <thead>
            <tr className="lbl t2">
              <th></th>
              <th>ARQUIVO</th>
              <th>FONTE</th>
              <th>EVENTOS</th>
              <th>AVISOS</th>
              <th>SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id} className={`ingest-${i.estado}`}>
                <td className={i.estado === 'ok' ? 'green' : i.estado === 'erro' ? 'red' : i.estado === 'enviando' ? 'amber' : 't3'} aria-label={i.estado}>
                  {i.estado === 'ok' ? '✓' : i.estado === 'erro' ? '✕' : i.estado === 'enviando' ? '▸' : '·'}
                </td>
                <td className="nowrap">
                  {i.file.name} <span className="t3">{formatBytes(i.file.size)}</span>
                </td>
                {i.estado === 'erro' ? (
                  <td colSpan={4} className="red">
                    {i.erro} · nada deste arquivo foi gravado{' '}
                    <button type="button" className="btn-stamp" onClick={() => tentarDeNovo(i.id)}>
                      [r] tentar de novo
                    </button>
                  </td>
                ) : i.res ? (
                  <>
                    <td style={{ color: sourceColor(i.res.fonte) }}>{i.res.detectado ? sourceCode(i.res.fonte) : '—'}</td>
                    <td className="num-data">{i.res.eventos}</td>
                    <td>
                      {!i.res.detectado ? (
                        <span className="amber">⊘ fonte não reconhecida: registrado na custódia, sem parser</span>
                      ) : i.res.ignorados ? (
                        <span className="amber">{i.res.ignorados} linha(s) ignorada(s)</span>
                      ) : (
                        <span className="t3">—</span>
                      )}
                    </td>
                    <td className="num-data t2" title={i.res.sha256}>
                      {i.res.sha256 ? `${i.res.sha256.slice(0, 12)}…` : '—'}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="t3">
                    {i.estado === 'enviando' ? 'enviando …' : 'na fila'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
});
