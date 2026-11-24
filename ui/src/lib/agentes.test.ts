import { describe, expect, it } from 'vitest';
import { analisaDiff, autorizado, autorizar, contaSemTag, cronometro, limpaInstrucao, relTempo } from './agentes';

const DIFF = [
  '--- caso/caso.md',
  '+++ rascunho/caso.md',
  '@@ -8,3 +8,5 @@',
  ' ## Resumo',
  '-Texto antigo do resumo com várias palavras aqui.',
  '+A colaboradora abriu o anexo e o programa rodou no computador dela [EVIDÊNCIA].',
  '+A senha provavelmente saiu da memória do Windows [HIPÓTESE]. Não se sabe quais arquivos foram levados [LIMITAÇÃO].',
  '+O atacante usou uma ferramenta de sincronização para copiar a pasta inteira.',
  '+## Gatilho',
  '--- caso/relatorios/relatorio-executivo.md',
  '+++ rascunho/relatorios/relatorio-executivo.md',
  '@@ -0,0 +1,2 @@',
  '+# Relatório executivo',
  '+| Campo | Valor |',
  '',
].join('\n');

describe('diff do rascunho', () => {
  it('separa por arquivo e conta +/−', () => {
    const a = analisaDiff(DIFF);
    expect(a.map((x) => [x.arquivo, x.mais, x.menos])).toEqual([
      ['caso.md', 4, 1],
      ['relatorios/relatorio-executivo.md', 2, 0],
    ]);
  });
  it('conta tags e afirmações sem tag', () => {
    const [caso, rel] = analisaDiff(DIFF);
    expect([caso!.evid, caso!.hip, caso!.lim, caso!.semTag]).toEqual([1, 1, 1, 1]);
    expect(rel!.semTag).toBe(0);
  });
  it('heurística ignora títulos, tabelas, linhas curtas e frases com tag', () => {
    expect(contaSemTag('## Um título com bastante palavras aqui mesmo')).toBe(0);
    expect(contaSemTag('| a | b | c | d | e | f |')).toBe(0);
    expect(contaSemTag('- curto demais')).toBe(0);
    expect(contaSemTag('Primeira frase sem tag nenhuma escrita aqui. Segunda frase com tag escrita aqui também [EVIDÊNCIA].')).toBe(1);
  });
});

describe('autorização de envio por sessão', () => {
  it('vale por caso e por provedor', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(autorizado('A', ['claude'], store)).toBe(false);
    autorizar('A', ['claude'], true, store);
    expect(autorizado('A', ['claude'], store)).toBe(true);
    expect(autorizado('A', ['claude', 'codex'], store)).toBe(false);
    expect(autorizado('B', ['claude'], store)).toBe(false);
    autorizar('A', ['claude'], false, store);
    expect(autorizado('A', ['claude'], store)).toBe(false);
  });
});

describe('textos', () => {
  it('instrução sem quebras/controles e até 500', () => {
    expect(limpaInstrucao('foco na\nconta\r\nsvc_backup\u0007')).toBe('foco na conta svc_backup');
    expect(limpaInstrucao('x'.repeat(600))).toHaveLength(500);
  });
  it('tempo relativo e cronômetro', () => {
    expect(relTempo(31.84)).toBe('+00:31.8');
    expect(relTempo(80)).toBe('+01:20.0');
    expect(cronometro(3725)).toBe('01:02:05');
  });
});
