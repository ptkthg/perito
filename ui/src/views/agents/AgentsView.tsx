// PAINEL AGENTES (brief §11, spec 07; `ga`, comando `agentes`).
// Escolha: ação [1]–[6], agente ←/→ (revisão cruzada usa os dois, em sequência: o backend
// aceita uma tarefa por caso). Aviso de envio sempre visível; autorização por caso e
// provedor na sessão. Execução com polling de 1 s, log com tempo relativo, cronômetro,
// "sem saída há N s", auto-rolagem com "▼ n linhas novas [End]", Ctrl+C cancela.
// Fim: ARQUIVO │ MUDANÇA │ TAGS e diff; [Espaço] marca, [a] aplica, [d] descarta. Nada entra
// no caso sem aplicar: o agente trabalha numa cópia (rascunho).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ApiError, api, describeError } from '../../lib/api';
import type { Entidades, Resumo } from '../../lib/types';
import type { Modo } from '../../lib/mode';
import type { ViewHandle } from '../../lib/view';
import { useLoad } from '../../lib/useLoad';
import {
  ACOES_UI,
  AGENTES,
  type AgenteId,
  FASES_PT,
  type JobEstado,
  STATUS_PT,
  analisaDiff,
  autorizado,
  autorizar,
  cronometro,
  kb,
  limpaInstrucao,
  relTempo,
} from '../../lib/agentes';
import { RichText } from '../../components/RichText';
import type { MsgKind } from '../../lib/msg';

export interface PresetAgente {
  acao: string;
  agente?: AgenteId;
  parametro?: string;
}

interface Props {
  caso: string;
  modo: Modo;
  rev: number;
  resumo: Resumo | null;
  entidades: Entidades | null;
  preset: PresetAgente | null;
  onAplicado(msg: string): void;
  onMsg(text: string, kind?: MsgKind): void;
  onConciliacao(): void;
}

interface Exec {
  agente: AgenteId;
  job: string | null;
  estado: JobEstado | null;
  linhas: { t: number; s: string }[];
  /** ms (relógio local) da última linha nova */
  ultimaSaida: number;
  /** ms local do início, para o cronômetro entre polls */
  t0: number;
  erroInicio?: string;
  aguardando: boolean;
}

interface Sessao {
  acao: string;
  parametro?: string;
  instrucao: string;
  execs: Exec[];
}

const kSessao = (caso: string) => `perito.agentes.${caso}`;
const terminal = (e: Exec) => !!e.estado && e.estado.status !== 'rodando';

export const AgentsView = forwardRef<ViewHandle, Props>(function AgentsView(props, ref) {
  const { caso, modo, rev, resumo, entidades, preset, onAplicado, onMsg, onConciliacao } = props;
  const guiado = modo === 'guiado';
  const disp = useLoad(() => api.agentesDisponiveis(), []);
  const docs = useLoad(() => api.docs(caso), [caso, rev]);
  const evs = useLoad(() => api.eventos(caso, {}), [caso, rev]);
  const [acao, setAcao] = useState(preset?.acao ?? 'resumo');
  const [agente, setAgente] = useState<AgenteId>(preset?.agente ?? 'claude');
  const [fase, setFase] = useState(preset?.parametro ?? 'acesso-inicial');
  const [instrucao, setInstrucao] = useState('');
  const [aut, setAut] = useState(false);
  const [erroAut, setErroAut] = useState(false);
  const [sessao, setSessao] = useState<Sessao | null>(() => {
    try {
      const v = sessionStorage.getItem(kSessao(caso));
      return v ? (JSON.parse(v) as Sessao) : null;
    } catch {
      return null;
    }
  });
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [verDiff, setVerDiff] = useState(true);
  const [conflito, setConflito] = useState<{ arquivo: string; msg: string; completo: boolean } | null>(null);
  const [historico, setHistorico] = useState(false);
  const [logCompleto, setLogCompleto] = useState(false);
  const [agora, setAgora] = useState(Date.now());
  const autRef = useRef<HTMLInputElement>(null);
  const logRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [novas, setNovas] = useState<number[]>([0, 0]);
  const colado = useRef<boolean[]>([true, true]);
  const hist = useLoad(() => (historico ? api.historicoAgentes(caso) : Promise.resolve([] as JobEstado[])), [caso, historico, rev]);

  // preset vindo de F0/F8/F9
  useEffect(() => {
    if (!preset) return;
    setAcao(preset.acao);
    if (preset.agente) setAgente(preset.agente);
    if (preset.parametro) setFase(preset.parametro);
  }, [preset]);

  const cruzada = acao === 'revisao-cruzada';
  const provs: AgenteId[] = cruzada ? ['claude', 'codex'] : [agente];
  useEffect(() => setAut(autorizado(caso, provs)), [caso, provs.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      if (sessao) sessionStorage.setItem(kSessao(caso), JSON.stringify(sessao));
      else sessionStorage.removeItem(kSessao(caso));
    } catch {
      /* sem sessionStorage */
    }
  }, [sessao, caso]);

  const acaoInfo = disp?.ok ? disp.v.acoes.find((a) => a.acao === acao) : undefined;
  const indisp = (a: AgenteId) => (disp?.ok ? !disp.v[a] : true);

  // ---------- tamanho estimado do envio ----------
  const envio = useMemo(() => {
    const itens: { nome: string; bytes: number }[] = [];
    if (docs?.ok) for (const d of docs.v) itens.push({ nome: `${d.nome.includes('/') ? d.nome : `${d.nome}.md`}`, bytes: d.bytes });
    if (evs?.ok) {
      const b = new Blob([JSON.stringify(evs.v.eventos)]).size;
      itens.push({ nome: `timeline + normalizado (${evs.v.total} eventos)`, bytes: b * 2 });
    }
    return { itens, total: itens.reduce((s, i) => s + i.bytes, 0) };
  }, [docs, evs]);
  const ents = entidades
    ? `${Object.keys(entidades.host ?? {}).length} máquinas, ${Object.keys(entidades.user ?? {}).length} contas, ${Object.keys(entidades.ip ?? {}).length} IPs, ${
        Object.keys(entidades.domain ?? {}).length
      } domínios`
    : 'nomes de usuário, hosts, IPs e e-mails';

  // ---------- execução ----------
  const atualizaExec = (i: number, f: (e: Exec) => Exec) =>
    setSessao((s) => (s ? { ...s, execs: s.execs.map((e, k) => (k === i ? f(e) : e)) } : s));

  const iniciar = useCallback(
    async (s: Sessao, i: number) => {
      const e = s.execs[i];
      if (!e) return;
      try {
        const r = await api.iniciarAgente(caso, {
          acao: s.acao,
          agente: e.agente,
          ...(s.acao === 'investigar-fase' ? { parametro: s.parametro } : {}),
          ...(s.instrucao ? { instrucao_extra: s.instrucao } : {}),
        });
        atualizaExec(i, (x) => ({ ...x, job: r.job, aguardando: false, t0: Date.now(), ultimaSaida: Date.now() }));
      } catch (x) {
        const m = x instanceof ApiError ? `${x.message}${x.detalhe ? ` — ${x.detalhe}` : ''}` : describeError(x);
        atualizaExec(i, (ex) => ({ ...ex, aguardando: false, erroInicio: m }));
        onMsg(`✕ ${e.agente.toUpperCase()} não iniciou: ${m}`, 'err');
      }
    },
    [caso, onMsg],
  );

  const executar = () => {
    if (!aut) {
      setErroAut(true);
      autRef.current?.focus();
      onMsg('✕ autorize o envio antes de executar', 'err');
      return;
    }
    if (sessao?.execs.some((e) => e.job && e.estado?.status !== 'concluido' && !terminal(e))) {
      onMsg('já existe tarefa em andamento neste caso', 'err');
      return;
    }
    const agentes: AgenteId[] = cruzada ? (['claude', 'codex'] as AgenteId[]).filter((a) => !indisp(a)) : [agente];
    if (!agentes.length || agentes.some(indisp)) {
      onMsg('✕ agente indisponível neste computador', 'err');
      return;
    }
    const s: Sessao = {
      acao,
      parametro: acao === 'investigar-fase' ? fase : undefined,
      instrucao: limpaInstrucao(instrucao).trim(),
      execs: agentes.map((a, i) => ({ agente: a, job: null, estado: null, linhas: [], ultimaSaida: Date.now(), t0: Date.now(), aguardando: i > 0 })),
    };
    setSessao(s);
    setMarcados(new Set());
    setConflito(null);
    colado.current = [true, true];
    void iniciar(s, 0);
  };

  // polling de 1 s
  const sessaoRef = useRef(sessao);
  sessaoRef.current = sessao;
  const voando = useRef(false);
  useEffect(() => {
    const t = window.setInterval(async () => {
      setAgora(Date.now());
      const s = sessaoRef.current;
      if (!s || voando.current) return; // nunca dois polls ao mesmo tempo (linhas duplicadas)
      voando.current = true;
      try {
      for (const [i, e] of s.execs.entries()) {
        if (!e.job || terminal(e)) continue;
        try {
          const st = await api.job(e.job, e.linhas.length);
          const novasLinhas = st.linhas.map((l) => ({ t: st.decorrido_s, s: l }));
          atualizaExec(i, (x) => ({
            ...x,
            estado: { ...st, linhas: [] },
            linhas: [...x.linhas, ...novasLinhas],
            ultimaSaida: novasLinhas.length ? Date.now() : x.ultimaSaida,
          }));
          if (novasLinhas.length && !colado.current[i]) setNovas((n) => n.map((v, k) => (k === i ? v + novasLinhas.length : v)));
          if (st.status !== 'rodando') {
            const p = STATUS_PT[st.status];
            onMsg(
              st.status === 'concluido'
                ? `✓ ${e.agente.toUpperCase()} CONCLUÍDO ${s.acao} em ${cronometro(st.decorrido_s)} · nada aplicado ainda`
                : `✕ ${e.agente.toUpperCase()} ${p.rotulo} em ${relTempo(st.decorrido_s)} · ${st.mensagem || p.guiado}`,
              st.status === 'concluido' ? 'ok' : 'err',
            );
            const prox = s.execs[i + 1];
            if (prox?.aguardando) {
              if (st.status === 'concluido') void iniciar(s, i + 1);
              else atualizaExec(i + 1, (x) => ({ ...x, aguardando: false, erroInicio: 'não iniciado: o primeiro agente não concluiu' }));
            }
          }
        } catch (x) {
          onMsg(`✕ falha ao acompanhar a tarefa: ${describeError(x)}`, 'err');
        }
      }
      } finally {
        voando.current = false;
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [iniciar, onMsg]);

  // auto-rolagem dos logs
  useEffect(() => {
    sessao?.execs.forEach((_, i) => {
      const el = logRefs.current[i];
      if (el && colado.current[i]) el.scrollTop = el.scrollHeight;
    });
  }, [sessao]);

  const rodando = sessao?.execs.find((e) => e.job && !terminal(e)) ?? null;
  const aguardandoAlgum = sessao?.execs.some((e) => e.aguardando) ?? false;

  const cancelar = async () => {
    if (!sessao) return;
    const r = sessao.execs.findIndex((e) => e.job && !terminal(e));
    if (r < 0) return;
    try {
      await api.cancelarJob(sessao.execs[r]!.job!);
      setSessao((s) => (s ? { ...s, execs: s.execs.map((e) => (e.aguardando ? { ...e, aguardando: false, erroInicio: 'cancelado antes de começar' } : e)) } : s));
      onMsg('cancelando… o rascunho será apagado; nada foi gravado no caso', 'info');
    } catch (x) {
      onMsg(`✕ não foi possível cancelar: ${describeError(x)}`, 'err');
    }
  };

  // ---------- fim: arquivos, marcação, aplicar/descartar ----------
  const arquivos = useMemo(() => {
    const out: { exec: number; job: string; agente: AgenteId; a: ReturnType<typeof analisaDiff>[number]; aplicado: boolean }[] = [];
    sessao?.execs.forEach((e, i) => {
      if (!e.estado || e.estado.status !== 'concluido' || !e.job) return;
      const an = analisaDiff(e.estado.diff);
      for (const nome of e.estado.arquivos_alterados) {
        const a = an.find((x) => x.arquivo === nome) ?? { arquivo: nome, mais: 0, menos: 0, evid: 0, hip: 0, lim: 0, semTag: 0, linhas: [] };
        out.push({ exec: i, job: e.job, agente: e.agente, a, aplicado: !!e.estado.arquivos_aplicados?.includes(nome) || !!e.estado.aplicado });
      }
    });
    return out;
  }, [sessao]);
  const chave = (f: (typeof arquivos)[number]) => `${f.job}\u0000${f.a.arquivo}`;
  const atual = arquivos[Math.min(cursor, arquivos.length - 1)] ?? null;

  const marcar = () => {
    if (!atual || atual.aplicado) return;
    setMarcados((m) => {
      const n = new Set(m);
      const k = chave(atual);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  const aplicar = async () => {
    const sel = arquivos.filter((f) => marcados.has(chave(f)) && !f.aplicado);
    if (!sel.length) {
      onMsg('✕ marque arquivos com Espaço antes de aplicar', 'err');
      return;
    }
    const porJob = new Map<string, string[]>();
    for (const f of sel) porJob.set(f.job, [...(porJob.get(f.job) ?? []), f.a.arquivo]);
    const feitos: string[] = [];
    for (const [job, nomes] of porJob) {
      try {
        await api.aplicarJob(job, nomes);
        feitos.push(...nomes);
        const i = sessao!.execs.findIndex((e) => e.job === job);
        atualizaExec(i, (x) => (x.estado ? { ...x, estado: { ...x.estado, aplicado: true, arquivos_aplicados: [...(x.estado.arquivos_aplicados ?? []), ...nomes] } } : x));
      } catch (x) {
        if (x instanceof ApiError && x.status === 409) {
          const arq = /: (.+)$/.exec(x.message)?.[1] ?? nomes[0] ?? '';
          setConflito({ arquivo: arq, msg: x.message, completo: false });
          onMsg(`✕ CONFLITO ${arq} mudou depois que a tarefa começou · nada foi aplicado`, 'err');
        } else onMsg(`✕ não aplicado: ${describeError(x)}`, 'err');
        return;
      }
    }
    setMarcados(new Set());
    onAplicado(`✓ APLICADO ${feitos.join(', ')} → caso ${caso}`);
  };

  const descartar = async () => {
    if (!sessao) return;
    const alvos = sessao.execs.filter((e) => e.job && e.estado?.status === 'concluido' && !e.estado.descartado);
    try {
      for (const e of alvos) await api.descartarJob(e.job!);
      setSessao(null);
      onMsg(`rascunho descartado (${alvos.length}) · nada foi gravado no caso`, 'info');
    } catch (x) {
      onMsg(`✕ não foi possível descartar: ${describeError(x)}`, 'err');
    }
  };

  const tentarDeNovo = () => {
    setSessao(null);
    setConflito(null);
    requestAnimationFrame(() => executar());
  };

  const abrirDoHistorico = async (id: string) => {
    try {
      const st = await api.job(id, 0);
      setSessao({
        acao: st.acao,
        instrucao: '',
        execs: [{ agente: st.agente, job: st.job, estado: { ...st, linhas: [] }, linhas: st.linhas.map((s) => ({ t: 0, s })), ultimaSaida: Date.now(), t0: Date.now(), aguardando: false }],
      });
      setHistorico(false);
    } catch (x) {
      onMsg(`✕ ${describeError(x)}`, 'err');
    }
  };

  // ---------- teclado ----------
  // Ctrl+Enter / Ctrl+C / End: o atalho global ignora Ctrl, então o painel escuta a janela.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter' && !rodando) {
        e.preventDefault();
        executar();
      } else if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && rodando && !window.getSelection()?.toString()) {
        e.preventDefault();
        void cancelar();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const fim = !!sessao && !rodando && !aguardandoAlgum && sessao.execs.every((e) => terminal(e) || e.erroInicio);

  useImperativeHandle(ref, () => ({
    onKey(e) {
      if (!sessao || !fim) {
        const a = ACOES_UI.find((x) => x.tecla === e.key);
        if (a && !rodando) {
          setAcao(a.acao);
          return true;
        }
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !rodando) {
          setAgente((g) => (g === 'claude' ? 'codex' : 'claude'));
          return true;
        }
      }
      if (e.key === 'End') {
        sessao?.execs.forEach((_, i) => {
          const el = logRefs.current[i];
          if (el) el.scrollTop = el.scrollHeight;
          colado.current[i] = true;
        });
        setNovas([0, 0]);
        return true;
      }
      if (e.key === 'h') {
        setHistorico((h) => !h);
        return true;
      }
      if (fim) {
        switch (e.key) {
          case 'j':
          case 'ArrowDown':
            setCursor((c) => Math.min(arquivos.length - 1, c + 1));
            return true;
          case 'k':
          case 'ArrowUp':
            setCursor((c) => Math.max(0, c - 1));
            return true;
          case ' ':
            marcar();
            return true;
          case 'Enter':
            setVerDiff((v) => !v);
            return true;
          case 'a':
            void aplicar();
            return true;
          case 'd':
            if (conflito) setConflito({ ...conflito, completo: !conflito.completo });
            else void descartar();
            return true;
          case 'r':
            tentarDeNovo();
            return true;
          case 'l':
            setLogCompleto((v) => !v);
            return true;
          case 'g':
            return false;
          case '8':
            onConciliacao();
            return true;
        }
      }
      return false;
    },
    escape() {
      if (conflito) {
        setConflito(null);
        return true;
      }
      if (historico) {
        setHistorico(false);
        return true;
      }
      if (fim) {
        setSessao(null);
        return true;
      }
      return false;
    },
  }));

  // ---------- render ----------
  const acaoRot = (a: string) => ACOES_UI.find((x) => x.acao === a)?.rotulo ?? a;
  const nomeAg = (a: AgenteId) => AGENTES.find((x) => x.id === a)!;

  const config = (
    <section className="ag-cfg" aria-label="Configurar tarefa de agente">
      <div className="ag-row">
        <span className="lbl t2 ag-k">AÇÃO</span>
        <div className="chips" role="radiogroup" aria-label="Ação">
          {ACOES_UI.map((a) => (
            <button key={a.acao} type="button" role="radio" aria-checked={acao === a.acao} className={`chip${acao === a.acao ? ' is-on' : ''}`} onClick={() => setAcao(a.acao)}>
              [{a.tecla}] {a.rotulo}
            </button>
          ))}
        </div>
      </div>
      {acao === 'investigar-fase' && (
        <div className="ag-row">
          <span className="lbl t2 ag-k">FASE</span>
          <div className="chips">
            {(acaoInfo?.parametros ?? Object.keys(FASES_PT)).map((p) => (
              <button key={p} type="button" className={`chip${fase === p ? ' is-on' : ''}`} onClick={() => setFase(p)}>
                {FASES_PT[p] ?? p}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="ag-row">
        <span className="lbl t2 ag-k">AGENTE</span>
        <div className="chips" role="radiogroup" aria-label="Agente">
          {AGENTES.map((a) => {
            const off = indisp(a.id);
            const on = cruzada || agente === a.id;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={off}
                className={`chip${on ? ' is-on' : ''}${off ? ' is-off' : ''}`}
                onClick={() => !off && !cruzada && setAgente(a.id)}
                title={off ? 'agente indisponível: CLI não encontrado neste computador' : undefined}
              >
                {a.nome} · {a.provedor}
                {off && <span className="red"> ✕ indisponível</span>}
              </button>
            );
          })}
          {cruzada && <span className="t2">revisão cruzada usa os dois, um depois do outro</span>}
          {!cruzada && <span className="t3">←/→ alterna</span>}
        </div>
      </div>
      <div className="ag-row">
        <span className="lbl t2 ag-k">ESCREVE EM</span>
        <span>
          {(acaoInfo?.arquivos ?? []).map((f) => f.replace('{agente}', cruzada ? '<agente>' : agente).replace('{data}', 'AAAAMMDD-HHMM')).join(' · ') || '—'}
          <span className="t2"> — num rascunho; nada entra no caso sem [a] aplicar</span>
        </span>
      </div>
      {guiado && acaoInfo && <p className="bench-help t2 ag-help">{acaoInfo.descricao}.</p>}

      {/* Aviso de envio: sempre visível, não pode ser fechado */}
      <div className={`ag-aviso${erroAut ? ' is-err' : ''}`} role="region" aria-label="Aviso de envio aos provedores">
        <p className="lbl ag-aviso-h">
          AVISO DE ENVIO · {provs.map((p) => `${nomeAg(p).provedor} (${nomeAg(p).nome})`).join(' e ')}
        </p>
        <p>
          Ao executar, o agente lê estes arquivos do caso e o conteúdo vai para {provs.length > 1 ? 'os provedores' : 'o provedor'} acima. Contém dados
          pessoais e técnicos: {ents}, e-mails.
        </p>
        <ul className="ag-envio">
          {envio.itens.map((i) => (
            <li key={i.nome}>
              <span>{i.nome}</span> <span className="t3">{kb(i.bytes)}</span>
            </li>
          ))}
          <li className="ag-total">
            <span className="lbl">TOTAL ESTIMADO</span> <span>≈ {kb(envio.total)}</span>
            <span className="t3"> · evidencias/brutas e custodia.csv não são enviados</span>
          </li>
        </ul>
        <label className="ag-check">
          <input
            ref={autRef}
            type="checkbox"
            checked={aut}
            onChange={(e) => {
              autorizar(caso, provs, e.target.checked);
              setAut(e.target.checked);
              setErroAut(false);
            }}
          />{' '}
          Autorizo o envio deste caso a {provs.map((p) => nomeAg(p).provedor).join(' e ')} nesta sessão
        </label>
        {erroAut && (
          <p className="red bench-err" role="alert">
            ✕ autorize o envio
          </p>
        )}
      </div>

      <label className="bench-l lbl t2" htmlFor="ag-instr">
        INSTRUÇÃO EXTRA (opcional)
      </label>
      {guiado && <p className="bench-help t2">Uma orientação curta para o agente (ex.: "dê atenção à conta svc_backup"). Vai como dado, não como comando.</p>}
      <input
        id="ag-instr"
        className="bench-in"
        maxLength={500}
        value={instrucao}
        onChange={(e) => setInstrucao(limpaInstrucao(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.ctrlKey) {
            e.preventDefault();
            setInstrucao((t) => limpaInstrucao(`${t} `));
          }
        }}
      />
      <div className="bench-meta">
        <span className={instrucao.length > 450 ? 'amber' : 't3'}>{instrucao.length}/500</span>
      </div>
      <p className="bench-actions">
        <button type="button" className="btn-stamp btn-main" onClick={executar}>
          {guiado ? `Executar ${acaoRot(acao)} (Ctrl+Enter)` : 'Ctrl+Enter executa'}
        </button>{' '}
        <button type="button" className="btn-stamp" onClick={() => setHistorico((h) => !h)}>
          [h] histórico
        </button>
      </p>
    </section>
  );

  const painelExec = (e: Exec, i: number) => {
    const st = e.estado;
    const dec = st?.status === 'rodando' || (!st && e.job) ? (agora - e.t0) / 1000 : (st?.decorrido_s ?? 0);
    const silencio = Math.floor((agora - e.ultimaSaida) / 1000);
    const status = st?.status ?? (e.erroInicio ? 'erro' : e.aguardando ? null : 'rodando');
    return (
      <div key={i} className="ag-exec">
        <p className="ag-exec-h">
          <span className="lbl">{nomeAg(e.agente).nome}</span> <span className="t3">· {nomeAg(e.agente).provedor}</span>{' '}
          {e.aguardando ? (
            <span className="t2">· aguardando o primeiro agente terminar</span>
          ) : (
            <>
              <span className={status === 'concluido' ? 'green' : status === 'rodando' ? 'amber' : 'red'}>
                {status === 'rodando' ? '▸' : status === 'concluido' ? '✓' : '✕'} {status ? STATUS_PT[status].rotulo : ''}
              </span>{' '}
              <span className="num-data">{cronometro(dec)}</span>
              {status === 'rodando' && silencio >= 3 && <span className="t2"> · sem saída há {silencio} s</span>}
            </>
          )}
        </p>
        <div
          className={`ag-log${logCompleto ? ' is-full' : ''}`}
          ref={(el) => {
            logRefs.current[i] = el;
          }}
          onScroll={(ev) => {
            const el = ev.currentTarget;
            const noFim = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
            colado.current[i] = noFim;
            if (noFim) setNovas((n) => n.map((v, k) => (k === i ? 0 : v)));
          }}
          role="log"
          aria-live="off"
          aria-label={`log do ${nomeAg(e.agente).nome}`}
        >
          {e.linhas.length === 0 && <span className="t3">{e.aguardando ? '—' : e.erroInicio ? e.erroInicio : 'iniciando…'}</span>}
          {e.linhas.map((l, k) => (
            <div key={k} className="ag-linha">
              <span className="t3 num-data">{relTempo(l.t)}</span> <span className={/^Editando /.test(l.s) ? 'amber' : ''}>{l.s}</span>
            </div>
          ))}
        </div>
        {novas[i]! > 0 && (
          <button type="button" className="ag-novas" onClick={() => logRefs.current[i]?.scrollTo({ top: 1e9 })}>
            ▼ {novas[i]} linhas novas [End]
          </button>
        )}
        {st && st.status !== 'rodando' && st.status !== 'concluido' && (
          <div className="ag-erro" role="alert">
            <p className="red">
              ✕ E-{st.status === 'tempo_esgotado' ? 'TEMPO' : st.status === 'violacao' ? 'VIOLAÇÃO' : st.status === 'cancelado' ? 'CANCELADO' : 'PROVEDOR'}{' '}
              {nomeAg(e.agente).nome} parou em {relTempo(st.decorrido_s)} · {st.mensagem || STATUS_PT[st.status].rotulo.toLowerCase()}
            </p>
            <p>nada foi gravado no caso · log: casos/{caso}/agentes/{st.job}.log</p>
            {guiado && <p className="t2 bench-help">{STATUS_PT[st.status].guiado}.</p>}
            <p className="bench-actions">
              <button type="button" className="btn-stamp" onClick={tentarDeNovo}>
                [r] tentar de novo
              </button>{' '}
              <button type="button" className="btn-stamp" onClick={() => setLogCompleto((v) => !v)}>
                [l] {logCompleto ? 'log compacto' : 'abrir log'}
              </button>{' '}
              <button type="button" className="btn-stamp" onClick={() => setSessao(null)}>
                [Esc] voltar
              </button>
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ag">
      <div className="strip">
        <span className="lbl">AGENTES</span> <span className="t3">▮</span> <span>{caso}</span>
        {resumo && <span className="t3"> · {resumo.total_eventos} eventos</span>}
        {disp && !disp.ok && <span className="red"> ✕ {disp.err}</span>}
        {disp?.ok && !disp.v.claude && !disp.v.codex && <span className="red"> ✕ nenhum agente disponível (CLI claude/codex não encontrado ou modo fixtures)</span>}
        <span className="strip-clauses t3">
          {guiado ? '1–6 ação · ←/→ agente · Ctrl+Enter executa · Ctrl+C cancela · h histórico' : '1–6 · ←→ · Ctrl+Enter · Ctrl+C · h · Espaço a d Enter'}
        </span>
      </div>

      {historico && (
        <section className="ag-hist ov-sec" aria-label="Histórico de tarefas">
          <h2 className="lbl ov-h">HISTÓRICO DE TAREFAS</h2>
          {!hist && <p className="t3">CARREGANDO …</p>}
          {hist?.ok && hist.v.length === 0 && <p className="t3">nenhuma tarefa de agente neste caso</p>}
          {hist?.ok && hist.v.length > 0 && (
            <table className="ioc">
              <thead>
                <tr className="lbl t2">
                  <th>INÍCIO (UTC)</th>
                  <th>AÇÃO</th>
                  <th>AGENTE</th>
                  <th>STATUS</th>
                  <th>ARQUIVOS</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {hist.v.map((h) => (
                  <tr key={h.job}>
                    <td className="num-data">{h.inicio.replace('T', ' ').slice(0, 19)}</td>
                    <td>{acaoRot(h.acao)}</td>
                    <td>{h.agente.toUpperCase()}</td>
                    <td className={h.status === 'concluido' ? 'green' : 'red'}>
                      {STATUS_PT[h.status]?.rotulo ?? h.status}
                      {h.aplicado ? ' · aplicado' : h.descartado ? ' · descartado' : h.status === 'concluido' ? ' · rascunho' : ''}
                    </td>
                    <td>{h.arquivos_alterados.join(', ') || '—'}</td>
                    <td>
                      <button type="button" className="btn-stamp" onClick={() => void abrirDoHistorico(h.job)}>
                        abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {!sessao && config}

      {sessao && (
        <section className="ag-run" aria-label="Execução">
          <p className="ag-run-h">
            <span className="lbl">{acaoRot(sessao.acao)}</span>
            {sessao.parametro && <span className="t2"> · fase {FASES_PT[sessao.parametro] ?? sessao.parametro}</span>}
            {sessao.instrucao && <span className="t3"> · instrução: “{sessao.instrucao}”</span>}{' '}
            {rodando && (
              <button type="button" className="btn-stamp" onClick={() => void cancelar()}>
                [Ctrl+C] cancelar
              </button>
            )}
          </p>
          <div className={`ag-logs${sessao.execs.length > 1 ? ' is-duplo' : ''}`}>{sessao.execs.map(painelExec)}</div>

          {fim && arquivos.length > 0 && (
            <div className="ag-fim">
              <p className="green">
                ✓ CONCLUÍDO · {arquivos.length} arquivo(s) no rascunho · {arquivos.some((f) => f.aplicado) ? 'parte aplicada' : 'nada aplicado ainda'}
              </p>
              {guiado && (
                <p className="bench-help t2">
                  Revise o diff. Marque com Espaço os arquivos que quer levar para o caso e aplique com [a]. "Sem tag" conta frases novas que afirmam algo sem
                  [EVIDÊNCIA], [HIPÓTESE] ou [LIMITAÇÃO] (heurística).
                </p>
              )}
              <table className="ioc ag-arq">
                <thead>
                  <tr className="lbl t2">
                    <th></th>
                    <th>ARQUIVO</th>
                    <th>AGENTE</th>
                    <th>MUDANÇA</th>
                    <th>TAGS</th>
                  </tr>
                </thead>
                <tbody>
                  {arquivos.map((f, i) => (
                    <tr key={chave(f)} className={i === cursor ? 'is-sel' : ''} onClick={() => setCursor(i)}>
                      <td>
                        {f.aplicado ? (
                          <span className="green">✓</span>
                        ) : (
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={marcados.has(chave(f))}
                            className="chip"
                            onClick={() => {
                              setCursor(i);
                              setMarcados((m) => {
                                const n = new Set(m);
                                if (n.has(chave(f))) n.delete(chave(f));
                                else n.add(chave(f));
                                return n;
                              });
                            }}
                          >
                            [{marcados.has(chave(f)) ? '×' : ' '}]
                          </button>
                        )}
                      </td>
                      <td className="nowrap">
                        <span className="selbar">{i === cursor ? '▌' : ' '}</span>
                        {f.a.arquivo}
                      </td>
                      <td>{f.agente.toUpperCase()}</td>
                      <td className="num-data">
                        <span className="green">+{f.a.mais}</span> <span className="red">−{f.a.menos}</span>
                      </td>
                      <td>
                        <span className="stamp stamp-evid">■{f.a.evid}</span> <span className="stamp stamp-hip">◇{f.a.hip}</span>{' '}
                        <span className="stamp stamp-lim hatch">⊘{f.a.lim}</span>{' '}
                        {f.a.semTag > 0 ? <span className="red">✕ {f.a.semTag} {f.a.semTag === 1 ? 'afirmação' : 'afirmações'} sem tag</span> : <span className="t3">todas com tag</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {conflito && (
                <div className="conflict" role="alert">
                  <p className="conflict-h">
                    <span className="red">✕ CONFLITO</span> <span className="lbl">{conflito.arquivo}</span> mudou depois que a tarefa começou
                  </p>
                  <p className="t2">
                    O arquivo real foi alterado (por você ou outro agente) enquanto o agente trabalhava. Nada foi aplicado e o rascunho continua aqui.
                  </p>
                  <p className="bench-actions">
                    <button type="button" className="btn-stamp" onClick={tentarDeNovo}>
                      [r] executar de novo sobre a versão atual
                    </button>{' '}
                    <button type="button" className="btn-stamp" onClick={() => setConflito({ ...conflito, completo: !conflito.completo })}>
                      [d] {conflito.completo ? 'diff mínimo' : 'diff completo'}
                    </button>{' '}
                    <button type="button" className="btn-stamp" onClick={() => setConflito(null)}>
                      [Esc] manter rascunho
                    </button>
                  </p>
                </div>
              )}
              <p className="bench-actions">
                <button type="button" className="btn-stamp btn-main" onClick={() => void aplicar()}>
                  [a] aplicar marcados
                </button>{' '}
                <button type="button" className="btn-stamp" onClick={marcar}>
                  [Espaço] marcar
                </button>{' '}
                <button type="button" className="btn-stamp" onClick={() => setVerDiff((v) => !v)}>
                  [Enter] {verDiff ? 'ocultar diff' : 'diff'}
                </button>{' '}
                <button type="button" className="btn-stamp" onClick={() => void descartar()}>
                  [d] descartar
                </button>{' '}
                {sessao.acao === 'revisao-cruzada' && (
                  <button type="button" className="btn-stamp" onClick={onConciliacao}>
                    [g8] conciliação
                  </button>
                )}
              </p>
              {verDiff && atual && (
                <pre className="diff ag-diff" aria-label={`diff de ${atual.a.arquivo}`}>
                  {(conflito?.completo || !conflito ? atual.a.linhas : atual.a.linhas.filter((l) => /^[-+@]/.test(l))).map((l, k) => (
                    <span key={k} className={l.startsWith('+') && !l.startsWith('+++') ? 'diff-add' : l.startsWith('-') && !l.startsWith('---') ? 'diff-del' : l.startsWith('@@') ? 'amber' : 't3'}>
                      {l.startsWith('+') && !l.startsWith('+++') ? (
                        <>
                          +<RichText text={l.slice(1)} />
                        </>
                      ) : (
                        l
                      )}
                      {'\n'}
                    </span>
                  ))}
                </pre>
              )}
            </div>
          )}
          {fim && arquivos.length === 0 && sessao.execs.every((e) => e.estado?.status === 'concluido') && (
            <p className="t2">✓ concluído sem mudanças nos arquivos do caso · [Esc] voltar</p>
          )}
        </section>
      )}
    </div>
  );
});
