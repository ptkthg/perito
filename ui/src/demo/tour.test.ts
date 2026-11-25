import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PASSOS, avancar, anterior, primeiraVisita, registrarVisita } from './passos';
import { GLOSSARIO, STATUS_TERMOS, termoParaRotulo } from './glossario';
import { VISOES } from '../lib/route';

// raw: mantém o teste estático independente de APIs de filesystem no bundle.
const fontes = import.meta.glob('../views/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// O ramo normal da raiz não usa o console; evita carregar toda a UI para este teste.
vi.mock('../components/CaseShell', () => ({ CaseShell: () => 'CONSOLE NORMAL' }));

describe('contrato do tour', () => {
  it('tem sete passos e alvos reais nas respectivas visões', () => {
    expect(PASSOS).toHaveLength(7);
    for (const passo of PASSOS) {
      expect(VISOES.some(v => v.key === passo.visao)).toBe(true);
      const arquivos = Object.entries(fontes).filter(([nome]) => nome.includes(passo.arquivo));
      expect(arquivos.some(([, texto]) => texto.includes(`data-tour="${passo.alvo}"`)), passo.alvo).toBe(true);
    }
  });
  it('respeita limites e encerra depois do último passo', () => {
    expect(anterior(0)).toBe(0);
    expect(anterior(4)).toBe(3);
    expect(avancar(0)).toBe(1);
    expect(avancar(6)).toBe(null);
  });
  it('persiste a visita sem depender do navegador', () => {
    const dados = new Map<string, string>();
    const storage = { getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => { dados.set(k, v); } };
    expect(primeiraVisita(storage)).toBe(true);
    registrarVisita(storage);
    expect(dados.get('perito-demo-tour')).toBe('visto');
    expect(primeiraVisita(storage)).toBe(false);
  });
  it('tolera armazenamento indisponível', () => {
    const storage = { getItem: () => { throw Error('bloqueado'); }, setItem: () => { throw Error('bloqueado'); } };
    expect(primeiraVisita(storage)).toBe(true);
    expect(() => registrarVisita(storage)).not.toThrow();
  });
});

describe('glossário', () => {
  it('cobre siglas da barra de status e todos os rótulos de abas', () => {
    for (const sigla of STATUS_TERMOS) expect(GLOSSARIO[termoParaRotulo(sigla) ?? ''], sigla).toBeTruthy();
    for (const v of VISOES) expect(GLOSSARIO[termoParaRotulo(v.rotulo) ?? ''], v.rotulo).toBeTruthy();
  });
});

describe('App normal', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
  it('mantém seleção de casos e não renderiza conteúdo da demo', async () => {
    vi.stubEnv('VITE_DEMO', '0');
    vi.stubGlobal('location', { hash: '#/' });
    const { App } = await import('../App');
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('CASOS');
    expect(html).not.toMatch(/DEMO ·|Abrir a demonstração|perito-demo|Passo 1\/7/);
    vi.stubGlobal('location', { hash: '#/caso/TESTE-001/visao' });
    const consoleHtml = renderToStaticMarkup(createElement(App));
    expect(consoleHtml).toContain('CONSOLE NORMAL');
    expect(consoleHtml).not.toMatch(/DEMO ·|Abrir a demonstração|perito-demo|Passo 1\/7/);
  });
});
