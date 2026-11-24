import { describe, expect, it } from 'vitest';
import { diffMinimo, indexaConfirmadas, loteIoc, motivoValido, parseConflito, sugerida, textoAchado, validaAchado } from './bancada';
import { expandRefs } from './refs';
import { ev } from './test-events';

describe('texto pré-preenchido do achado', () => {
  it('só fatos do evento: descrição + host/conta/cmd que faltam', () => {
    const t = textoAchado(
      ev({
        description: 'powershell.exe iniciado por excel.exe',
        host: 'ws-fin-023',
        user: 'm.silva',
        cmdline: 'powershell.exe -nop -w hidden -enc SQBFAFgA',
      }),
    );
    expect(t).toBe('powershell.exe iniciado por excel.exe em ws-fin-023 (conta m.silva) · cmd: powershell.exe -nop -w hidden -enc SQBFAFgA');
  });
  it('rede: destino e host deduzido; sem pipes nem quebras', () => {
    const t = textoAchado(ev({ description: 'Conexão|de\nsaída', dst_ip: '203.0.113.45', dst_port: 443, extra: { src_host: 'ws-fin-023' } }));
    expect(t).toBe('Conexão de saída em ~ws-fin-023 → 203.0.113.45:443');
  });
  it('limita a 300 e valida mínimo de 20', () => {
    expect(textoAchado(ev({ description: 'x'.repeat(500) })).length).toBe(300);
    expect(validaAchado('curto demais')).toMatch(/mínimo de 20/);
    expect(validaAchado('um texto com mais de vinte caracteres')).toBeNull();
  });
});

describe('409', () => {
  it('reconhece o corpo de conflito', () => {
    expect(parseConflito(409, { erro: 'conflito', versao_atual: '1-2', conteudo_atual: 'abc' })).toEqual({ versaoAtual: '1-2', conteudoAtual: 'abc' });
    expect(parseConflito(400, { erro: 'conflito' })).toBeNull();
    expect(parseConflito(409, { erro: 'outro' })).toBeNull();
  });
  it('diff mínimo mostra só o que mudou, com contexto e lacunas', () => {
    const a = ['| # |', '| A1 | x |', 'l3', 'l4', 'l5', 'l6'].join('\n');
    const b = ['| # |', '| A1 | x |', 'l3', 'l4', 'l5', 'l6', '| A2 | agente |'].join('\n');
    const d = diffMinimo(a, b);
    expect(d.map((x) => (x ? `${x.op}${x.linha}` : '…'))).toEqual([' l6', '+| A2 | agente |']);
    const d2 = diffMinimo('a\nb\nc\nd\ne\nf\ng', 'a\nB\nc\nd\ne\nf\nG');
    expect(d2.map((x) => (x ? `${x.op}${x.linha}` : '…'))).toEqual([' a', '-b', '+B', ' c', '…', ' f', '-g', '+G']);
  });
});

describe('IOC: lote e motivo', () => {
  it('motivos aceitos', () => {
    expect(motivoValido('falso positivo')).toBeNull();
    expect(motivoValido('outro: CDN corporativa')).toBeNull();
    expect(motivoValido('porque sim')).toMatch(/escolha um motivo/);
    expect(motivoValido(`outro: ${'x'.repeat(201)}`)).toMatch(/200/);
  });
  it('lote sem duplicatas; descarte exige motivo', () => {
    const l = [
      { tipo: 'ip', valor: '1.2.3.4' },
      { tipo: 'ip', valor: '1.2.3.4' },
      { tipo: 'dominio', valor: 'a.example' },
    ];
    expect(loteIoc(l, 'confirmado').itens).toEqual([
      { tipo: 'ip', valor: '1.2.3.4', confianca: 'confirmado' },
      { tipo: 'dominio', valor: 'a.example', confianca: 'confirmado' },
    ]);
    expect(() => loteIoc(l, 'descartado')).toThrow(/motivo/);
    expect(loteIoc(l, 'descartado', 'interno').itens[0]).toEqual({ tipo: 'ip', valor: '1.2.3.4', confianca: 'descartado', motivo: 'interno' });
    expect(() => loteIoc([], 'confirmado')).toThrow(/nenhum/);
  });
});

describe('técnicas confirmadas', () => {
  it('confirmada = citada num achado com a ref do evento', () => {
    const conf = indexaConfirmadas([{ attack: ['T1059.001'], evidencia: ['d.csv:8-9'] }], expandRefs);
    const e = ev({ raw_ref: 'd.csv:9', mitre: ['T1059.001', 'T1027'], extra: { mitre_heuristica: ['T1059.001', 'T1027'] } });
    expect(sugerida(e, 'T1059.001', conf)).toBe(false);
    expect(sugerida(e, 'T1027', conf)).toBe(true);
    expect(sugerida({ ...e, raw_ref: 'd.csv:10' }, 'T1059.001', conf)).toBe(true);
  });
});
