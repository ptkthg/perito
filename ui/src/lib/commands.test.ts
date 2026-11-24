import { describe, expect, it } from 'vitest';
import { parseCommand, parseTimeSpec, suggest, tokenize } from './commands';

const ctx = { baseDay: '2026-11-10' };

describe('tokenize', () => {
  it('respeita aspas', () => {
    expect(tokenize('filtro texto="rclone copy" host=a').tokens).toEqual(['filtro', 'texto=rclone copy', 'host=a']);
  });
});

describe('parseCommand', () => {
  it('filtro com =, != e aliases src=/type=', () => {
    expect(parseCommand('filtro host=ws-fin-023 src!=splunk type=dns', ctx)).toEqual({
      kind: 'filtro',
      clauses: [
        { field: 'host', neg: false, value: 'ws-fin-023' },
        { field: 'fonte', neg: true, value: 'splunk' },
        { field: 'tipo', neg: false, value: 'dns' },
      ],
    });
  });
  it('filtro: erros de campo e de sintaxe', () => {
    expect(() => parseCommand('filtro cor=azul', ctx)).toThrow(/campo desconhecido/);
    expect(() => parseCommand('filtro host', ctx)).toThrow(/argumento inválido/);
    expect(() => parseCommand('filtro', ctx)).toThrow(/uso: filtro/);
  });
  it('pivo --ip X e --host=X', () => {
    expect(parseCommand('pivo --ip 203.0.113.45', ctx)).toEqual({ kind: 'pivo', field: 'ip', value: '203.0.113.45' });
    expect(parseCommand('pivo --host=srv-file-01', ctx)).toEqual({ kind: 'pivo', field: 'host', value: 'srv-file-01' });
    expect(() => parseCommand('pivo --cor x', ctx)).toThrow(/pivô desconhecido/);
    expect(() => parseCommand('pivo --ip', ctx)).toThrow(/falta o valor/);
  });
  it('janela HH:MM..HH:MM inclusiva até o fim do minuto; vazia remove', () => {
    expect(parseCommand('janela 13:00..13:30', ctx)).toEqual({
      kind: 'janela',
      de: '2026-11-10T13:00:00.000Z',
      ate: '2026-11-10T13:30:59.999Z',
    });
    expect(parseCommand('janela', ctx)).toEqual({ kind: 'janela', de: null, ate: null });
    expect(parseCommand('janela 13:00..', ctx)).toEqual({ kind: 'janela', de: '2026-11-10T13:00:00.000Z', ate: null });
    expect(() => parseCommand('janela 14:00..13:00', ctx)).toThrow(/janela invertida/);
    expect(() => parseCommand('janela 25:00..26:00', ctx)).toThrow(/horário inválido/);
  });
  it('ir HH:MM:SS e ISO com fuso', () => {
    expect(parseCommand('ir 13:15:30', ctx)).toEqual({ kind: 'ir', ts: '2026-11-10T13:15:30.000Z' });
    expect(parseCommand('ir 2026-11-10T10:15:30-03:00', ctx)).toEqual({ kind: 'ir', ts: '2026-11-10T13:15:30.000Z' });
    expect(() => parseCommand('ir', ctx)).toThrow(/uso: ir/);
  });
  it('limpar, u, ajuda e desconhecido', () => {
    expect(parseCommand('limpar', ctx)).toEqual({ kind: 'limpar' });
    expect(parseCommand('u', ctx)).toEqual({ kind: 'desfazer' });
    expect(parseCommand('ajuda', ctx)).toEqual({ kind: 'ajuda' });
    expect(() => parseCommand('xyz', ctx)).toThrow(/comando desconhecido/);
  });
  it('parseTimeSpec preenche ms', () => {
    expect(parseTimeSpec('13:15:30.66', ctx.baseDay)).toBe('2026-11-10T13:15:30.660Z');
  });
});

describe('suggest', () => {
  it('completa comando e valores com contagem', () => {
    const entidades = { host: { 'ws-fin-023': { primeira: '', ultima: '', eventos: 23, fontes: [] }, 'ws-fin-041': { primeira: '', ultima: '', eventos: 1, fontes: [] } } };
    expect(suggest('fil', { entidades, resumo: null }).items[0]!.text).toBe('filtro');
    const s = suggest('filtro host=ws', { entidades, resumo: null });
    expect(s.items.map((i) => [i.text, i.count])).toEqual([
      ['host=ws-fin-023', 23],
      ['host=ws-fin-041', 1],
    ]);
  });
});
