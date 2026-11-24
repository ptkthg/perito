// Camada de dados com interface única e dois modos:
//  (a) API real: fetch em /api/... com o header X-Perito-Token lido da <meta>.
//      Em dev, se a meta ainda for "__PERITO_TOKEN__", não manda header (o proxy do Vite injeta).
//  (b) Fixtures (VITE_FIXTURES=1): lê /fixtures/<ID>/*.json e aplica filtros no cliente
//      com a mesma semântica do backend (ver lib/filters.ts).

import type {
  Achado,
  CasoItem,
  DocConteudo,
  DocItem,
  Entidades,
  EventQuery,
  EventosResp,
  Hipotese,
  Histograma,
  IocsResp,
  PeritoEvent,
  Resumo,
} from './types';
import { compileQuery, queryString } from './filters';
import { tsMs } from './format';
import type { Grafo } from './graph';
import { type Conflito, parseConflito } from './bancada';

export interface Formato {
  fonte: string;
  descricao: string;
}

export interface IngestaoResult {
  ok: boolean;
  arquivo: string;
  fonte: string;
  eventos: number;
  ignorados: number;
  sha256: string;
  detectado: boolean;
  mensagem?: string;
}

export interface EscritaOk {
  ok: true;
  versao: string;
  id?: string;
  existente?: boolean;
  [k: string]: unknown;
}

export interface NovaHipotese {
  titulo: string;
  confianca: string;
  sustentacao?: string;
  confirmaria?: string;
  refutaria?: string;
  proximo_passo?: string;
  fase?: string;
}

export interface PatchHipotese {
  status?: string;
  confianca?: string;
  proximo_passo?: string;
  justificativa?: string;
  refs_add?: { ref: string; relacao: 'apoia' | 'contradiz' }[];
}

/** Arquivo-alvo de cada escrita (para versão otimista e mensagens). */
export type Arquivo = 'achados.md' | 'hipoteses.md' | 'iocs.csv' | 'limitacoes.md';

export interface PeritoApi {
  readonly modo: 'api' | 'fixtures';
  casos(): Promise<CasoItem[]>;
  resumo(id: string): Promise<Resumo>;
  eventos(id: string, q?: EventQuery): Promise<EventosResp>;
  histograma(id: string, q?: EventQuery & { bucket?: number }): Promise<Histograma>;
  entidades(id: string): Promise<Entidades>;
  iocs(id: string): Promise<IocsResp>;
  docs(id: string): Promise<DocItem[]>;
  doc(id: string, nome: string): Promise<DocConteudo>;
  hipoteses(id: string): Promise<Hipotese[]>;
  achados(id: string): Promise<Achado[]>;
  grafo(id: string, relevantes?: boolean): Promise<Grafo>;
  formatos(): Promise<Formato[]>;
  // ---- escritas (spec 06); todas mandam `versao` e podem lançar ConflitoError (409)
  criarAchado(id: string, b: { idx: number; achado: string; attack: string[] }): Promise<EscritaOk>;
  criarHipotese(id: string, b: NovaHipotese): Promise<EscritaOk>;
  patchHipotese(id: string, hn: string, b: PatchHipotese): Promise<EscritaOk>;
  criarIoc(id: string, b: Record<string, string>): Promise<EscritaOk>;
  patchIoc(id: string, b: Record<string, unknown>): Promise<EscritaOk>;
  criarLimitacao(id: string, b: { limitacao: string; impacto: string; mitigacao: string }): Promise<EscritaOk>;
  ingerir(id: string, f: File, opts: { fonte?: string; obs?: string }, progresso?: (enviados: number, total: number) => void): Promise<IngestaoResult>;
}

// ---------------------------------------------------------------- versões (X-Perito-Versao)
const versoes = new Map<string, string>();
const vk = (caso: string, arq: string) => `${caso}\u0000${arq}`;
export const versaoDe = (caso: string, arq: string) => versoes.get(vk(caso, arq));
export const setVersao = (caso: string, arq: string, v: string | null | undefined) => {
  if (v) versoes.set(vk(caso, arq), v);
};

/** 409: o arquivo mudou depois da leitura. Leva o conteúdo atual para o diff. */
export class ConflitoError extends Error {
  readonly arquivo: string;
  readonly conflito: Conflito;
  constructor(arquivo: string, c: Conflito) {
    super(`conflito em ${arquivo}`);
    this.name = 'ConflitoError';
    this.arquivo = arquivo;
    this.conflito = c;
  }
}

/** Erro de API com status HTTP e corpo {erro, detalhe} quando houver. */
export class ApiError extends Error {
  readonly status: number;
  readonly detalhe: string | undefined;
  readonly rota: string;
  constructor(status: number, mensagem: string, rota: string, detalhe?: string) {
    super(mensagem);
    this.name = 'ApiError';
    this.status = status;
    this.detalhe = detalhe;
    this.rota = rota;
  }
}

const TOKEN_PLACEHOLDER = '__PERITO_TOKEN__';

function readToken(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="perito-token"]');
  const t = meta?.content ?? '';
  if (!t || t === TOKEN_PLACEHOLDER) return null;
  return t;
}

const enc = encodeURIComponent;

async function request<T>(rota: string, init: RequestInit & { headers?: Record<string, string> } = {}, arquivo?: string): Promise<{ data: T; versao: string | null }> {
  let resp: Response;
  try {
    resp = await fetch(rota, { ...init, headers: { Accept: 'application/json', ...(init.headers ?? {}) }, cache: 'no-store' });
  } catch (e) {
    throw new ApiError(0, 'falha de rede', rota, e instanceof Error ? e.message : String(e));
  }
  const text = await resp.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    if (!resp.ok) throw new ApiError(resp.status, `HTTP ${resp.status}`, rota, text.slice(0, 200));
    throw new ApiError(resp.status, 'JSON inválido', rota, text.slice(0, 120));
  }
  if (!resp.ok) {
    const c = parseConflito(resp.status, body);
    if (c) throw new ConflitoError(arquivo ?? rota, c);
    const b = (body ?? {}) as { erro?: string; detalhe?: string };
    throw new ApiError(resp.status, b.erro ?? `HTTP ${resp.status}`, rota, b.detalhe);
  }
  return { data: body as T, versao: resp.headers.get('X-Perito-Versao') };
}

async function getJson<T>(rota: string, headers: Record<string, string> = {}): Promise<T> {
  return (await request<T>(rota, { headers })).data;
}

// ---------------------------------------------------------------- API real
class RealApi implements PeritoApi {
  readonly modo = 'api' as const;
  private headers(): Record<string, string> {
    const t = readToken();
    return t ? { 'X-Perito-Token': t } : {};
  }
  private get<T>(path: string) {
    return getJson<T>(`/api${path}`, this.headers());
  }
  /** GET que guarda X-Perito-Versao do arquivo-alvo. */
  private async getV<T>(path: string, caso: string, arq: string): Promise<T> {
    const r = await request<T>(`/api${path}`, { headers: this.headers() });
    setVersao(caso, arq, r.versao ?? (r.data as { versao?: string } | null)?.versao);
    return r.data;
  }
  /** Garante uma versão conhecida antes de escrever (lendo o arquivo-alvo se preciso). */
  private async versao(caso: string, arq: Arquivo): Promise<string> {
    const v = versaoDe(caso, arq);
    if (v) return v;
    if (arq === 'achados.md') await this.achados(caso);
    else if (arq === 'hipoteses.md') await this.hipoteses(caso);
    else if (arq === 'iocs.csv') await this.iocs(caso);
    else await this.doc(caso, 'limitacoes');
    return versaoDe(caso, arq) ?? '0-0';
  }
  private async escrever(method: 'POST' | 'PATCH', caso: string, path: string, arq: Arquivo, body: Record<string, unknown>): Promise<EscritaOk> {
    const versao = await this.versao(caso, arq);
    const r = await request<EscritaOk>(
      `/api/casos/${enc(caso)}${path}`,
      { method, headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, versao }) },
      arq,
    );
    setVersao(caso, arq, r.data.versao);
    return r.data;
  }
  grafo(id: string, relevantes = false) {
    return this.get<Grafo>(`/casos/${enc(id)}/grafo${relevantes ? '?relevantes=1' : ''}`);
  }
  formatos() {
    return this.get<Formato[]>('/formatos');
  }
  criarAchado(id: string, b: { idx: number; achado: string; attack: string[] }) {
    return this.escrever('POST', id, '/achados', 'achados.md', b);
  }
  criarHipotese(id: string, b: NovaHipotese) {
    return this.escrever('POST', id, '/hipoteses', 'hipoteses.md', { ...b });
  }
  patchHipotese(id: string, hn: string, b: PatchHipotese) {
    return this.escrever('PATCH', id, `/hipoteses/${enc(hn)}`, 'hipoteses.md', { ...b });
  }
  criarIoc(id: string, b: Record<string, string>) {
    return this.escrever('POST', id, '/iocs', 'iocs.csv', b);
  }
  patchIoc(id: string, b: Record<string, unknown>) {
    return this.escrever('PATCH', id, '/iocs', 'iocs.csv', b);
  }
  criarLimitacao(id: string, b: { limitacao: string; impacto: string; mitigacao: string }) {
    return this.escrever('POST', id, '/limitacoes', 'limitacoes.md', b);
  }
  /** Um arquivo por requisição: bytes brutos (octet-stream); progresso via XHR upload.onprogress. */
  ingerir(id: string, f: File, opts: { fonte?: string; obs?: string }, progresso?: (enviados: number, total: number) => void): Promise<IngestaoResult> {
    const rota = `/api/casos/${enc(id)}/ingestao`;
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', rota);
      for (const [k, v] of Object.entries(this.headers())) x.setRequestHeader(k, v);
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.setRequestHeader('X-Perito-Arquivo', enc(f.name));
      if (opts.fonte && opts.fonte !== 'auto') x.setRequestHeader('X-Perito-Fonte', opts.fonte);
      if (opts.obs) x.setRequestHeader('X-Perito-Obs', enc(opts.obs));
      x.upload.onprogress = (e) => progresso?.(e.loaded, e.lengthComputable ? e.total : f.size);
      x.onerror = () => reject(new ApiError(0, 'falha de rede', rota, 'conexão interrompida durante o envio'));
      x.onload = () => {
        let body: unknown = null;
        try {
          body = x.responseText ? JSON.parse(x.responseText) : null;
        } catch {
          /* corpo não-JSON */
        }
        if (x.status >= 200 && x.status < 300) resolve(body as IngestaoResult);
        else {
          const b = (body ?? {}) as { erro?: string; detalhe?: string };
          reject(new ApiError(x.status, b.erro ?? `HTTP ${x.status}`, rota, b.detalhe ?? x.responseText.slice(0, 200)));
        }
      };
      x.send(f);
    });
  }
  casos() {
    return this.get<CasoItem[]>('/casos');
  }
  resumo(id: string) {
    return this.get<Resumo>(`/casos/${enc(id)}/resumo`);
  }
  eventos(id: string, q: EventQuery = {}) {
    return this.get<EventosResp>(`/casos/${enc(id)}/eventos${queryString(q)}`);
  }
  histograma(id: string, q: EventQuery & { bucket?: number } = {}) {
    return this.get<Histograma>(`/casos/${enc(id)}/histograma${queryString(q)}`);
  }
  entidades(id: string) {
    return this.get<Entidades>(`/casos/${enc(id)}/entidades`);
  }
  iocs(id: string) {
    return this.getV<IocsResp>(`/casos/${enc(id)}/iocs`, id, 'iocs.csv');
  }
  docs(id: string) {
    return this.get<DocItem[]>(`/casos/${enc(id)}/docs`);
  }
  doc(id: string, nome: string) {
    // revisoes/x.md e relatorios/x.md mantêm a barra (rota /doc/revisoes/x.md)
    const n = nome.split('/').map(enc).join('/');
    return this.getV<DocConteudo>(`/casos/${enc(id)}/doc/${n}`, id, nome.includes('/') ? nome : `${nome}.md`);
  }
  hipoteses(id: string) {
    return this.getV<Hipotese[]>(`/casos/${enc(id)}/hipoteses`, id, 'hipoteses.md');
  }
  achados(id: string) {
    return this.getV<Achado[]>(`/casos/${enc(id)}/achados`, id, 'achados.md');
  }
}

// ---------------------------------------------------------------- fixtures
/** Lê ?stress=N da URL (só no modo fixtures): multiplica eventos para teste de carga. */
function stressCount(): number {
  const v = new URLSearchParams(location.search).get('stress');
  const n = v ? Number.parseInt(v, 10) : 0;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2_000_000) : 0;
}

/**
 * Gera N eventos a partir dos originais, com deslocamento de tempo determinístico
 * e raw_ref sufixado para deixar claro que é dado sintético de carga.
 */
function multiply(base: PeritoEvent[], n: number): PeritoEvent[] {
  if (base.length === 0) return base;
  const out: PeritoEvent[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const b = base[k % base.length]!;
    const rep = Math.floor(k / base.length);
    if (rep === 0) {
      out[k] = b;
      continue;
    }
    const ms = tsMs(b.ts_utc) + ((rep * 7919) % 90_000);
    out[k] = { ...b, ts_utc: new Date(ms).toISOString(), raw_ref: `${b.raw_ref}~stress${rep}` };
  }
  out.sort((a, b) => (a.ts_utc < b.ts_utc ? -1 : a.ts_utc > b.ts_utc ? 1 : 0));
  for (let i = 0; i < out.length; i++) out[i] = { ...out[i]!, idx: i };
  return out;
}

class FixturesApi implements PeritoApi {
  readonly modo = 'fixtures' as const;
  private cache = new Map<string, Promise<unknown>>();
  private eventsCache = new Map<string, Promise<PeritoEvent[]>>();

  private file<T>(path: string): Promise<T> {
    let p = this.cache.get(path) as Promise<T> | undefined;
    if (!p) {
      p = getJson<T>(`/fixtures/${path}`).catch((e: unknown) => {
        this.cache.delete(path);
        if (e instanceof ApiError && (e.message === 'JSON inválido' || e.status === 404)) {
          throw new ApiError(404, 'fixture ausente', `/fixtures/${path}`, e.detalhe);
        }
        throw e;
      });
      this.cache.set(path, p);
    }
    return p;
  }

  private allEvents(id: string): Promise<PeritoEvent[]> {
    let p = this.eventsCache.get(id);
    if (!p) {
      p = this.file<EventosResp>(`${enc(id)}/eventos.json`).then((r) => {
        const n = stressCount();
        return n > 0 ? multiply(r.eventos, n) : r.eventos;
      });
      this.eventsCache.set(id, p);
    }
    return p;
  }

  /** Lista de casos: public/fixtures/<VITE_FIXTURES_CASO|TESTE-001>/casos.json. */
  casos(): Promise<CasoItem[]> {
    const id = (import.meta.env.VITE_FIXTURES_CASO as string | undefined) || 'TESTE-001';
    return this.file<CasoItem[]>(`${enc(id)}/casos.json`);
  }

  async resumo(id: string): Promise<Resumo> {
    const r = await this.file<Resumo>(`${enc(id)}/resumo.json`);
    const n = stressCount();
    return n > 0 ? { ...r, total_eventos: n } : r;
  }

  async eventos(id: string, q: EventQuery = {}): Promise<EventosResp> {
    const all = await this.allEvents(id);
    const pred = compileQuery(q);
    let eventos = all.filter(pred);
    const filtrados = eventos.length;
    if (q.limite && q.limite > 0) eventos = eventos.slice(0, q.limite);
    return { total: all.length, filtrados, eventos };
  }

  async histograma(id: string, q: EventQuery & { bucket?: number } = {}): Promise<Histograma> {
    const base = await this.file<Histograma>(`${enc(id)}/histograma.json`);
    const { eventos } = await this.eventos(id, { ...q, limite: undefined });
    return rebucket(base, eventos);
  }

  entidades(id: string) {
    return this.file<Entidades>(`${enc(id)}/entidades.json`);
  }
  iocs(id: string) {
    return this.file<IocsResp>(`${enc(id)}/iocs.json`);
  }
  docs(id: string) {
    return this.file<DocItem[]>(`${enc(id)}/docs.json`);
  }
  /** doc-<nome>.json (barras viram "_": revisoes/x.md → doc-revisoes_x.md.json). */
  doc(id: string, nome: string) {
    return this.file<DocConteudo>(`${enc(id)}/doc-${enc(nome.replaceAll('/', '_'))}.json`);
  }
  hipoteses(id: string) {
    return this.file<Hipotese[]>(`${enc(id)}/hipoteses.json`);
  }
  achados(id: string) {
    return this.file<Achado[]>(`${enc(id)}/achados.json`);
  }
  grafo(id: string) {
    return this.file<Grafo>(`${enc(id)}/grafo.json`);
  }
  async formatos(): Promise<Formato[]> {
    return [{ fonte: 'auto', descricao: 'Detecção automática da fonte' }];
  }
  criarAchado(): Promise<EscritaOk> {
    return Promise.reject(this.erroRO());
  }
  criarHipotese(): Promise<EscritaOk> {
    return Promise.reject(this.erroRO());
  }
  patchHipotese(): Promise<EscritaOk> {
    return Promise.reject(this.erroRO());
  }
  criarIoc(): Promise<EscritaOk> {
    return Promise.reject(this.erroRO());
  }
  patchIoc(): Promise<EscritaOk> {
    return Promise.reject(this.erroRO());
  }
  criarLimitacao(): Promise<EscritaOk> {
    return Promise.reject(this.erroRO());
  }
  ingerir(): Promise<IngestaoResult> {
    return Promise.reject(this.erroRO());
  }
  private erroRO(): ApiError {
    return new ApiError(0, 'modo fixtures é somente leitura', 'fixtures', 'rode com a API real (perito ui) para gravar');
  }
}

/**
 * Recalcula os baldes de um histograma a partir de uma lista de eventos, mantendo
 * bucket/início/n_baldes, cobertura e marcas. Usado no modo fixtures e para filtros locais.
 */
export function rebucket(base: Histograma, eventos: PeritoEvent[]): Histograma {
  const inicio = tsMs(base.inicio);
  const bucketMs = base.bucket_s * 1000;
  const n = base.n_baldes;
  const fontes: Record<string, number[]> = {};
  for (const k of Object.keys(base.fontes)) fontes[k] = new Array<number>(n).fill(0);
  for (const ev of eventos) {
    const i = Math.floor((tsMs(ev.ts_utc) - inicio) / bucketMs);
    if (i < 0 || i >= n) continue;
    (fontes[ev.source] ??= new Array<number>(n).fill(0))[i]! += 1;
  }
  return { ...base, fontes };
}

export const api: PeritoApi = import.meta.env.VITE_FIXTURES === '1' ? new FixturesApi() : new RealApi();

/** Mensagem curta de erro para a linha de status / estado inline. */
export function describeError(e: unknown): string {
  if (e instanceof ConflitoError) return `E-409 conflito em ${e.arquivo}`;
  if (e instanceof ApiError) {
    const st = e.status ? `E-${e.status}` : 'E-REDE';
    return `${st} ${e.rota} ${e.message}${e.detalhe ? ` — ${e.detalhe}` : ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}
