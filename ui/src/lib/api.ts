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

async function getJson<T>(rota: string, headers: Record<string, string> = {}): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(rota, { headers: { Accept: 'application/json', ...headers }, cache: 'no-store' });
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
    const b = (body ?? {}) as { erro?: string; detalhe?: string };
    throw new ApiError(resp.status, b.erro ?? `HTTP ${resp.status}`, rota, b.detalhe);
  }
  return body as T;
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
    return this.get<IocsResp>(`/casos/${enc(id)}/iocs`);
  }
  docs(id: string) {
    return this.get<DocItem[]>(`/casos/${enc(id)}/docs`);
  }
  doc(id: string, nome: string) {
    // revisoes/x.md e relatorios/x.md mantêm a barra (rota /doc/revisoes/x.md)
    const n = nome.split('/').map(enc).join('/');
    return this.get<DocConteudo>(`/casos/${enc(id)}/doc/${n}`);
  }
  hipoteses(id: string) {
    return this.get<Hipotese[]>(`/casos/${enc(id)}/hipoteses`);
  }
  achados(id: string) {
    return this.get<Achado[]>(`/casos/${enc(id)}/achados`);
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
  if (e instanceof ApiError) {
    const st = e.status ? `E-${e.status}` : 'E-REDE';
    return `${st} ${e.rota} ${e.message}${e.detalhe ? ` — ${e.detalhe}` : ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}
