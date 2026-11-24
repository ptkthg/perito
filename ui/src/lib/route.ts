// Roteamento por hash, sem biblioteca: #/caso/<ID>/<visao>.
import { useEffect, useState } from 'react';
import type { Visao } from './types';

export const VISOES: { key: Visao; tecla: string; rotulo: string; entrega: string }[] = [
  { key: 'visao', tecla: 'F0', rotulo: 'VISÃO GERAL', entrega: 'I1' },
  { key: 'timeline', tecla: 'F1', rotulo: 'TIMELINE', entrega: 'I1' },
  { key: 'entidades', tecla: 'F2', rotulo: 'ENTIDADES', entrega: 'I2' },
  { key: 'attack', tecla: 'F3', rotulo: 'ATT&CK', entrega: 'I3' },
  { key: 'ioc', tecla: 'F4', rotulo: 'IOC', entrega: 'I3' },
  { key: 'cobertura', tecla: 'F5', rotulo: 'COBERTURA', entrega: 'I3' },
  { key: 'hipoteses', tecla: 'F6', rotulo: 'HIP/ACH', entrega: 'I2' },
  { key: 'escopo', tecla: 'F7', rotulo: 'ESCOPO', entrega: 'I4' },
  { key: 'revisao', tecla: 'F8', rotulo: 'REVISÃO', entrega: 'I4' },
  { key: 'relatorios', tecla: 'F9', rotulo: 'REL', entrega: 'I4' },
];

export interface Route {
  caso: string | null;
  /** null quando a URL não diz a visão: o App escolhe conforme o modo. */
  visao: Visao | null;
}

const VALID = new Set<string>(VISOES.map((v) => v.key));

export function parseHash(hash: string): Route {
  const m = /^#\/caso\/([^/]+)(?:\/([^/?#]+))?/.exec(hash);
  if (!m) return { caso: null, visao: null };
  const caso = decodeURIComponent(m[1]!);
  const v = m[2] && VALID.has(m[2]) ? (m[2] as Visao) : null;
  return { caso, visao: v };
}

export function hrefFor(caso: string, visao: Visao = 'timeline'): string {
  return `#/caso/${encodeURIComponent(caso)}/${visao}`;
}

export function navigate(caso: string | null, visao: Visao = 'timeline'): void {
  location.hash = caso ? hrefFor(caso, visao) : '#/';
}

export function useRoute(): Route {
  const [r, setR] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setR(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

/** Visão pela tecla de atalho: "0".."9" (F0/g0 … F9/g9). */
export function visaoPorTecla(n: string): Visao | null {
  return VISOES.find((v) => v.tecla === `F${n}`)?.key ?? null;
}
