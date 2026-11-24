// Tipos do contrato JSON da API local do Perito (docs/tasks/04-ui-api.md).
// Todos os horários são ISO 8601 UTC com sufixo "Z" e milissegundos.

export type IsoUtc = string;

/** Fontes conhecidas; o backend pode trazer outras, por isso `string` também é aceito. */
export type KnownSource =
  | 'defender'
  | 'sentinel'
  | 'entra_signin'
  | 'entra_audit'
  | 'splunk'
  | 'elastic'
  | 'wazuh';

export type EventType =
  | 'process'
  | 'network'
  | 'dns'
  | 'file'
  | 'registry'
  | 'logon'
  | 'signin'
  | 'audit'
  | 'email'
  | 'service'
  | 'scheduled_task'
  | 'alert'
  | 'other';

// ---------- /api/casos ----------
export interface CasoItem {
  id: string;
  titulo: string;
  fase: string;
  evidencias: number;
  eventos: number;
}

// ---------- /api/casos/{id}/resumo ----------
export interface JanelaTempo {
  primeiro: IsoUtc | null;
  ultimo: IsoUtc | null;
}

export interface FonteResumo {
  eventos: number;
  primeiro: IsoUtc;
  ultimo: IsoUtc;
}

export interface TecnicaResumo {
  id: string;
  nome: string;
  tatica: string;
  eventos: number;
}

export interface CustodiaResumo {
  integra: boolean;
  arquivos: number;
  problemas: string[];
}

export interface Contagens {
  hipoteses: number;
  achados: number;
  limitacoes: number;
  iocs_registrados: number;
}

export interface Resumo {
  id: string;
  titulo: string;
  fase: string;
  total_eventos: number;
  janela: JanelaTempo;
  por_fonte: Record<string, FonteResumo>;
  por_tipo: Record<string, number>;
  tecnicas: TecnicaResumo[];
  hosts_sem_edr: string[];
  custodia: CustodiaResumo;
  contagens: Contagens;
}

// ---------- /api/casos/{id}/eventos ----------
/** Campos de `extra` que a UI usa; o resto é livre (depende do parser). */
export interface EventExtra {
  src_host?: string | null;
  dst_host?: string | null;
  observer?: string | null;
  host_ip?: string | null;
  corroborado_por?: string[];
  volume_alto?: boolean;
  mitre_heuristica?: string[];
  duplicatas?: string[] | number;
  user_original?: string | null;
  [k: string]: unknown;
}

export interface PeritoEvent {
  idx: number;
  ts_utc: IsoUtc;
  source: KnownSource | string;
  event_type: EventType | string;
  raw_ref: string;
  ts_original: string | null;
  host: string | null;
  user: string | null;
  src_ip: string | null;
  dst_ip: string | null;
  dst_port: number | null;
  domain: string | null;
  process: string | null;
  parent: string | null;
  cmdline: string | null;
  file_path: string | null;
  sha256: string | null;
  action: string | null;
  outcome: string | null;
  description: string | null;
  severity: string | number | null;
  mitre: string[];
  extra: EventExtra;
}

export interface EventosResp {
  total: number;
  filtrados: number;
  eventos: PeritoEvent[];
}

/** Campos aceitos em `excluir_<campo>` pelo backend. */
export type ExcludableField = 'host' | 'user' | 'ip' | 'fonte' | 'tipo';

/** Query de /eventos e /histograma (todas opcionais). */
export interface EventQuery {
  host?: string;
  user?: string;
  ip?: string;
  hash?: string;
  dominio?: string;
  de?: IsoUtc;
  ate?: IsoUtc;
  /** lista separada por vírgula */
  fonte?: string;
  /** lista separada por vírgula */
  tipo?: string;
  texto?: string;
  limite?: number;
  excluir?: Partial<Record<ExcludableField, string[]>>;
}

// ---------- /api/casos/{id}/histograma ----------
export type MarcaTipo = 'log_limpo' | 'volume_alto';

export interface Marca {
  ts: IsoUtc;
  tipo: MarcaTipo | string;
  raw_ref: string;
}

export interface Histograma {
  bucket_s: number;
  inicio: IsoUtc;
  fim: IsoUtc;
  n_baldes: number;
  fontes: Record<string, number[]>;
  cobertura: Record<string, { primeiro: IsoUtc; ultimo: IsoUtc }>;
  marcas: Marca[];
}

// ---------- /api/casos/{id}/entidades ----------
export type EntityKind = 'host' | 'user' | 'ip' | 'domain' | 'sha256' | 'process';

export interface EntityInfo {
  primeira: IsoUtc;
  ultima: IsoUtc;
  eventos: number;
  fontes: string[];
}

export type Entidades = Partial<Record<EntityKind, Record<string, EntityInfo>>>;

// ---------- /api/casos/{id}/iocs ----------
export interface IocCandidato {
  tipo: string;
  valor: string;
  primeira_vez_utc: IsoUtc;
  ultima_vez_utc: IsoUtc;
  fonte: string;
  contexto: string;
  confianca: string;
  [k: string]: unknown;
}

export interface IocsResp {
  candidatos: IocCandidato[];
  registrados: Record<string, string>[];
}

// ---------- /api/casos/{id}/docs e /doc/{nome} ----------
export type DocGrupo = 'caso' | 'revisoes' | 'relatorios';

export interface DocItem {
  nome: string;
  grupo: DocGrupo | string;
  bytes: number;
  mtime: IsoUtc;
}

export interface DocConteudo {
  nome: string;
  grupo: DocGrupo | string;
  conteudo: string;
  mtime: IsoUtc;
}

// ---------- /api/casos/{id}/hipoteses ----------
export type HipoteseStatus = 'aberta' | 'confirmada' | 'refutada' | 'inconclusiva';

export interface Hipotese {
  id: string;
  titulo: string;
  status: HipoteseStatus | string | null;
  confianca: 'baixa' | 'média' | 'alta' | null;
  fase: string | null;
  sustentacao: string | null;
  confirmaria: string | null;
  refutaria: string | null;
  proximo_passo: string | null;
  refs: string[];
  linha: number;
}

// ---------- /api/casos/{id}/achados ----------
export interface Achado {
  id: string;
  utc: IsoUtc | string;
  host: string | null;
  conta: string | null;
  achado: string;
  attack: string[];
  evidencia: string[];
  linha: number;
}

// ---------- erros ----------
export interface ApiErroBody {
  erro: string;
  detalhe?: string;
}

// ---------- visões / rotas ----------
export type Visao =
  | 'visao'
  | 'timeline'
  | 'entidades'
  | 'attack'
  | 'ioc'
  | 'cobertura'
  | 'hipoteses'
  | 'escopo'
  | 'revisao'
  | 'relatorios';
