// Painel de detalhe (direita). Pares rótulo/valor; valores pivotáveis em ciano.
// ANALISTA: rótulos curtos do brief. GUIADO: rótulos por extenso + botões de ação visíveis
// (carimbo de borda 1px, sem raio). A expansão do conteúdo acontece aqui, nunca na linha.
import type { PeritoEvent } from '../../lib/types';
import type { FilterField } from '../../lib/filters';
import { shortHash, sourceCode, sourceColor, typeCode } from '../../lib/format';
import { sugerida } from '../../lib/bancada';
import { useConfirmadas } from '../../lib/conf';
import { type Modo, sourceLong, typePt } from '../../lib/mode';
import { type TacticOf, sortTechniques, tecnicaPt } from '../../lib/attack-pt';

interface Props {
  ev: PeritoEvent | null;
  pos: number;
  total: number;
  pinned: boolean;
  marked: boolean;
  modo: Modo;
  tacticOf: TacticOf;
  techNames: ReadonlyMap<string, string>;
  onPivot(field: FilterField, value: string): void;
  onFilter(field: FilterField, value: string): void;
  onCopy(label: string, value: string): void;
  onMark(): void;
  onJumpRef(rawRef: string): void;
  onPromover(): void;
  onVincular(): void;
  /** Formulário da bancada aberto (substitui o corpo do detalhe, painel alargado). */
  bancada: React.ReactNode;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : v != null && typeof v !== 'object' ? String(v) : null);

const L = {
  analista: {
    ts: 'TS', tsOrig: 'TS ORIG', host: 'HOST', user: 'USER', ips: 'SRC→DST', hostIp: 'HOST IP', dom: 'DOMÍNIO', proc: 'PROC', pai: 'PAI',
    arq: 'ARQUIVO', hash: 'SHA256', acao: 'AÇÃO', res: 'RESULTADO', sev: 'SEVERIDADE', resumo: 'RESUMO', cmd: 'CMD',
    corrob: 'CORROB', obs: '⊙ OBSERV', deduz: '~ DEDUZ', vol: '▲ VOLUME ALTO', dup: 'DUPLICATAS', attack: 'ATT&CK', raw: 'RAW',
  },
  guiado: {
    ts: 'HORÁRIO', tsOrig: 'NA FONTE', host: 'MÁQUINA', user: 'CONTA', ips: 'DE → PARA', hostIp: 'IP MÁQUINA', dom: 'DOMÍNIO', proc: 'PROGRAMA',
    pai: 'ABERTO POR', arq: 'ARQUIVO', hash: 'HASH', acao: 'AÇÃO', res: 'RESULTADO', sev: 'GRAVIDADE', resumo: 'O QUE ACONTECEU',
    cmd: 'LINHA DE COMANDO', corrob: 'TAMBÉM VISTO EM', obs: 'VISTO POR', deduz: 'MÁQUINA DEDUZIDA', vol: '▲ ENVIO DE GRANDE VOLUME',
    dup: 'DUPLICATAS', attack: 'TÉCNICAS (ATT&CK)', raw: 'REFERÊNCIA',
  },
} as const;

function Pv({ field, value, children, onPivot }: { field: FilterField; value: string; children?: React.ReactNode; onPivot: Props['onPivot'] }) {
  return (
    <button type="button" className="pivot dv-btn" onClick={() => onPivot(field, value)} title={`pivô ${field}=${value}`} aria-label={`pivô ${field} ${value}`}>
      {children ?? value}
    </button>
  );
}

function Pair({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="dv-pair">
      <dt className="lbl t2">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Btn({ children, onClick, title }: { children: React.ReactNode; onClick(): void; title?: string }) {
  return (
    <button type="button" className="btn-stamp" onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export function DetailPanel(props: Props) {
  const { ev, pos, total, pinned, marked, modo, tacticOf, techNames, onPivot, onFilter, onCopy, onMark, onJumpRef, onPromover, onVincular, bancada } = props;
  const guiado = modo === 'guiado';
  const t = L[modo];
  const conf = useConfirmadas();
  const width = String(total).length;
  if (!ev) {
    return (
      <aside className="detail" aria-label="Detalhe do evento">
        <div className="detail-head">
          <span className="lbl t2">EVENTO —</span>
        </div>
        <div className="detail-body t3">{guiado ? 'clique numa linha da tabela para ver os detalhes aqui' : 'nenhum evento selecionado'}</div>
      </aside>
    );
  }
  const x = ev.extra;
  const srcHost = str(x.src_host);
  const dstHost = str(x.dst_host);
  const observer = str(x.observer);
  const hostIp = str(x.host_ip);
  const corrob = Array.isArray(x.corroborado_por) ? x.corroborado_por : [];
  const dup = x.duplicatas;
  const dupList = Array.isArray(dup) ? dup.map(String) : [];
  const userOrig = str(x.user_original);
  const hostVal = ev.host ?? srcHost;
  const techs = sortTechniques(ev.mitre, tacticOf);

  return (
    <aside className={`detail${pinned ? ' is-pinned' : ''}`} aria-label="Detalhe do evento">
      <div className="detail-head">
        <span className="lbl">
          EVENTO{' '}
          <span className="num-data">
            {pos >= 0 ? String(pos + 1).padStart(width, '0') : '—'}/{total}
          </span>
        </span>{' '}
        <span style={{ color: sourceColor(ev.source) }}>{guiado ? sourceLong(ev.source) : sourceCode(ev.source)}</span>
        <span className="t3">·</span>
        <span className="t2">{guiado ? typePt(ev.event_type) : typeCode(ev.event_type)}</span>
        {pinned && <span className="lbl amber detail-pin"> FIXO</span>}
        {marked && <span className="amber"> *</span>}
      </div>
      {bancada ? <div className="detail-body">{bancada}</div> : null}
      <div className="detail-body" hidden={!!bancada}>
        {guiado && (
          <div className="dv-actions" role="group" aria-label="Ações sobre este evento">
            {hostVal && (
              <>
                <Btn onClick={() => onFilter('host', hostVal)} title={`adiciona host=${hostVal} aos filtros`}>
                  Filtrar por esta máquina
                </Btn>
                <Btn onClick={() => onPivot('host', hostVal)} title={`substitui os filtros por host=${hostVal}`}>
                  Pivotar na máquina
                </Btn>
              </>
            )}
            {ev.user && (
              <Btn onClick={() => onFilter('user', ev.user!)} title={`adiciona user=${ev.user}`}>
                Filtrar por esta conta
              </Btn>
            )}
            {ev.dst_ip && <Btn onClick={() => onPivot('ip', ev.dst_ip!)}>Pivotar no IP {ev.dst_ip}</Btn>}
            {ev.src_ip && ev.src_ip !== ev.dst_ip && <Btn onClick={() => onPivot('ip', ev.src_ip!)}>Pivotar no IP {ev.src_ip}</Btn>}
            {ev.domain && <Btn onClick={() => onPivot('dominio', ev.domain!)}>Pivotar no domínio</Btn>}
            {ev.sha256 && <Btn onClick={() => onPivot('hash', ev.sha256!)}>Pivotar no hash</Btn>}
            {ev.cmdline && <Btn onClick={() => onCopy('linha de comando', ev.cmdline!)}>Copiar comando</Btn>}
            <Btn onClick={() => onCopy('referência', ev.raw_ref)} title="copia o raw_ref (arquivo e linha de origem)">
              Copiar referência
            </Btn>
            <Btn onClick={onMark}>{marked ? 'Desmarcar' : 'Marcar'}</Btn>
            <Btn onClick={onPromover} title="tecla a: grava em achados.md com ■EVIDÊNCIA">
              Promover a achado [a]
            </Btn>
            <Btn onClick={onVincular} title="tecla H: liga este evento a uma hipótese">
              Vincular a hipótese [H]
            </Btn>
          </div>
        )}
        <dl className="dv">
          <Pair k={t.ts}>{ev.ts_utc}</Pair>
          {ev.ts_original && ev.ts_original !== ev.ts_utc && <Pair k={t.tsOrig}>{ev.ts_original}</Pair>}
          <Pair k={t.host}>
            {ev.host ? (
              <Pv field="host" value={ev.host} onPivot={onPivot} />
            ) : srcHost ? (
              <Pv field="host" value={srcHost} onPivot={onPivot}>
                <em className="deduced-pv">~{srcHost}</em>
              </Pv>
            ) : (
              <span className="t3">—</span>
            )}
          </Pair>
          {ev.user && (
            <Pair k={t.user}>
              <Pv field="user" value={ev.user} onPivot={onPivot} />
              {userOrig && userOrig !== ev.user && <span className="t3"> ({userOrig})</span>}
            </Pair>
          )}
          {(ev.src_ip || ev.dst_ip) && (
            <Pair k={t.ips}>
              {ev.src_ip ? <Pv field="ip" value={ev.src_ip} onPivot={onPivot} /> : <span className="t3">—</span>}
              <span className="t3"> → </span>
              {ev.dst_ip ? <Pv field="ip" value={ev.dst_ip} onPivot={onPivot} /> : <span className="t3">—</span>}
              {ev.dst_port != null && <span>:{ev.dst_port}</span>}
            </Pair>
          )}
          {hostIp && hostIp !== ev.src_ip && (
            <Pair k={t.hostIp}>
              <Pv field="ip" value={hostIp} onPivot={onPivot} />
            </Pair>
          )}
          {ev.domain && (
            <Pair k={t.dom}>
              <Pv field="dominio" value={ev.domain} onPivot={onPivot} />
            </Pair>
          )}
          {ev.process && <Pair k={t.proc}>{ev.process}</Pair>}
          {ev.parent && <Pair k={t.pai}>{ev.parent}</Pair>}
          {ev.file_path && (
            <Pair k={t.arq}>
              <span className="wrap">{ev.file_path}</span>
            </Pair>
          )}
          {ev.sha256 && (
            <Pair k={t.hash}>
              <Pv field="hash" value={ev.sha256} onPivot={onPivot}>
                {shortHash(ev.sha256)}
              </Pv>
            </Pair>
          )}
          {ev.action && <Pair k={t.acao}>{ev.action}</Pair>}
          {ev.outcome && <Pair k={t.res}>{ev.outcome}</Pair>}
          {ev.severity != null && ev.severity !== '' && <Pair k={t.sev}>{String(ev.severity)}</Pair>}
        </dl>

        {ev.description && (
          <div className="dv-block">
            <div className="dv-rule lbl t2">{t.resumo}</div>
            <div className="wrap">{ev.description}</div>
          </div>
        )}

        {ev.cmdline && (
          <div className="dv-block">
            <div className="dv-rule lbl t2">{t.cmd}</div>
            <div className={`wrap cmdline${pinned ? '' : ' is-clamped'}`}>{ev.cmdline}</div>
            {!pinned && <div className="t3">{guiado ? '[↵] ou duplo clique: mostra tudo' : '[↵] fixa e expande'}</div>}
          </div>
        )}

        {corrob.length > 0 && (
          <div className="dv-block">
            <div className="lbl t2">
              {guiado ? (
                <>
                  {t.corrob} {corrob.length} {corrob.length === 1 ? 'OUTRA FONTE' : 'OUTRAS FONTES'}
                </>
              ) : (
                <>
                  <span className="g">≡</span> {t.corrob} {corrob.length}
                </>
              )}
            </div>
            {corrob.map((r) => (
              <div key={r}>
                <button type="button" className="pivot dv-btn" onClick={() => onJumpRef(r)} title="ir ao evento corroborante (se estiver no filtro)">
                  {r}
                </button>
              </div>
            ))}
          </div>
        )}
        {observer && (
          <div className="dv-line">
            <span className="lbl t2">{t.obs}</span> <Pv field="host" value={observer} onPivot={onPivot} />
            {observer !== ev.host && <span className="t3">{guiado ? ' (não é a máquina do evento)' : ' ≠ host'}</span>}
          </div>
        )}
        {srcHost && (
          <div className="dv-line">
            <span className="lbl t2">{t.deduz}</span> {!guiado && <em className="deduced-pv">src_host </em>}
            <Pv field="host" value={srcHost} onPivot={onPivot} />
            {ev.src_ip && (
              <>
                <span className="t2">{guiado ? ' pelo IP de origem ' : ' de SRC IP '}</span>
                <span>{ev.src_ip}</span>
              </>
            )}
          </div>
        )}
        {dstHost && (
          <div className="dv-line">
            <span className="lbl t2">{guiado ? 'DESTINO DEDUZIDO' : '~ DEDUZ'}</span> {!guiado && <em className="deduced-pv">dst_host </em>}
            <Pv field="host" value={dstHost} onPivot={onPivot} />
            {ev.dst_ip && (
              <>
                <span className="t2">{guiado ? ' pelo IP de destino ' : ' de DST IP '}</span>
                <span>{ev.dst_ip}</span>
              </>
            )}
          </div>
        )}
        {x.volume_alto === true && (
          <div className="dv-line">
            <span className="lbl t2">{t.vol}</span>
          </div>
        )}
        {(dupList.length > 0 || (typeof dup === 'number' && dup > 0)) && (
          <div className="dv-line">
            <span className="lbl t2">{t.dup}</span> {dupList.length ? dupList.join(' ') : String(dup)}
          </div>
        )}

        {techs.length > 0 && (
          <div className="dv-block">
            <div className="lbl t2">{t.attack}</div>
            {techs.map((tech) => {
              const h = sugerida(ev, tech, conf);
              return (
                <div key={tech} className="dv-tech" title={techNames.get(tech) ?? undefined}>
                  <span>
                    {tech}
                    {h && <span className="amber">?</span>}
                  </span>{' '}
                  <span className="t2">{guiado ? tecnicaPt(tech, techNames.get(tech)) : (techNames.get(tech) ?? '')}</span>{' '}
                  <span className={`lbl ${h ? 'amber' : 'green'}`}>{h ? (guiado ? 'SUGERIDO (A CONFIRMAR)' : 'SUGERIDO') : 'FONTE'}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="dv-line">
          <span className="lbl t2">{t.raw}</span> <span className="wrap">{ev.raw_ref}</span>
        </div>
      </div>
      <div className="detail-foot lbl">
        <span>
          <span className="amber">[a]</span>ACHADO
        </span>{' '}
        <span>
          <span className="amber">[H]</span>HIP
        </span>{' '}
        <span>
          <span className="amber">[p]</span>PIVÔ
        </span>{' '}
        <span>
          <span className="amber">[x]</span>RAW
        </span>
      </div>
    </aside>
  );
}
