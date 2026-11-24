// Preferências persistidas em localStorage (densidade, tema, marcas por caso).
export type Densidade = 18 | 20 | 24;
export const DENSIDADES: Densidade[] = [18, 20, 24];

const K_DENS = 'perito.densidade';
const K_TEMA = 'perito.tema';
const kMarcas = (caso: string) => `perito.marcas.${caso}`;

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* armazenamento indisponível: preferência fica só na sessão */
  }
}

export function loadDensidade(): Densidade {
  const n = Number(safeGet(K_DENS));
  return (DENSIDADES as number[]).includes(n) ? (n as Densidade) : 20;
}
export function saveDensidade(d: Densidade): void {
  safeSet(K_DENS, String(d));
}

export type Tema = 'escuro' | 'claro';
export function loadTema(): Tema {
  return safeGet(K_TEMA) === 'claro' ? 'claro' : 'escuro';
}
export function saveTema(t: Tema): void {
  safeSet(K_TEMA, t);
}

/** Marcas do analista guardadas por raw_ref (estável entre builds, ao contrário de idx). */
export function loadMarcas(caso: string): Set<string> {
  try {
    const v = JSON.parse(safeGet(kMarcas(caso)) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
export function saveMarcas(caso: string, m: Set<string>): void {
  safeSet(kMarcas(caso), JSON.stringify([...m]));
}
