// Modo GUIADO (padrão, linguagem simples) × ANALISTA (tela densa do brief).
import { createContext, useContext } from 'react';

export type Modo = 'guiado' | 'analista';

const K = 'perito.modo';
const K_DICA = 'perito.dica-oculta';

export function loadModo(): Modo {
  try {
    return localStorage.getItem(K) === 'analista' ? 'analista' : 'guiado';
  } catch {
    return 'guiado';
  }
}
export function saveModo(m: Modo): void {
  try {
    localStorage.setItem(K, m);
  } catch {
    /* sem armazenamento */
  }
}

export function loadDicaOculta(): boolean {
  try {
    return localStorage.getItem(K_DICA) === '1';
  } catch {
    return false;
  }
}
export function saveDicaOculta(v: boolean): void {
  try {
    localStorage.setItem(K_DICA, v ? '1' : '0');
  } catch {
    /* sem armazenamento */
  }
}

export const ModoContext = createContext<Modo>('guiado');
export const useModo = (): Modo => useContext(ModoContext);

/** Fonte por extenso (modo GUIADO). */
export const SOURCE_LONG: Record<string, string> = {
  defender: 'Defender',
  sentinel: 'Sentinel',
  entra_signin: 'Entra·login',
  entra_audit: 'Entra·auditoria',
  splunk: 'Splunk',
  elastic: 'Elastic',
  wazuh: 'Wazuh',
};

/** Tipo de evento em português (modo GUIADO). */
export const TYPE_PT: Record<string, string> = {
  process: 'processo',
  network: 'rede',
  dns: 'DNS',
  file: 'arquivo',
  registry: 'registro',
  logon: 'logon',
  signin: 'login nuvem',
  audit: 'auditoria',
  email: 'e-mail',
  service: 'serviço',
  scheduled_task: 'tarefa agendada',
  alert: 'alerta',
  other: 'outro',
};

export const sourceLong = (s: string) => SOURCE_LONG[s] ?? s;
export const typePt = (t: string) => TYPE_PT[t] ?? t;
