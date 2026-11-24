import { describe, expect, it } from 'vitest';
import { KILL_CHAIN, makeTacticOf, primaryTechnique, resolveTatica, sortTechniques, tecnicaPt } from './attack-pt';
import { ev } from './test-events';

const tecnicas = [
  { id: 'T1027', nome: 'Obfuscated Files or Information', tatica: 'Evasão de defesa', eventos: 1 },
  { id: 'T1059.001', nome: 'PowerShell', tatica: 'Execução', eventos: 2 },
  { id: 'T1204.002', nome: 'Malicious File', tatica: 'Execução', eventos: 1 },
  { id: 'T1105', nome: 'Ingress Tool Transfer', tatica: 'Comando e controle', eventos: 2 },
  { id: 'T1059', nome: 'Command and Scripting Interpreter', tatica: 'Execução', eventos: 0 },
];
const tacticOf = makeTacticOf(tecnicas);

describe('técnica principal', () => {
  it('powershell (T1027, T1059.001, T1204.002) → T1059.001', () => {
    expect(primaryTechnique(ev({ mitre: ['T1027', 'T1059.001', 'T1204.002'] }), tacticOf)).toBe('T1059.001');
  });
  it('Evasão de defesa fica por último mesmo sozinha antes de C2', () => {
    expect(sortTechniques(['T1027', 'T1105'], tacticOf)).toEqual(['T1105', 'T1027']);
  });
  it('mesma tática: subtécnica antes, depois lexical', () => {
    expect(sortTechniques(['T1059', 'T1204.002', 'T1059.001'], tacticOf)).toEqual(['T1059.001', 'T1204.002', 'T1059']);
  });
  it('sem técnica → null; tática desconhecida herda do pai', () => {
    expect(primaryTechnique(ev({ mitre: [] }), tacticOf)).toBeNull();
    expect(tacticOf('T1059.999')).toBe('Execução');
  });
});

describe('rótulos', () => {
  it('nomes PT e resolução de tática', () => {
    expect(tecnicaPt('T1003.001')).toBe('Roubo de senhas (LSASS)');
    expect(tecnicaPt('T9999', 'fallback')).toBe('fallback');
    expect(resolveTatica('saida de dados')).toBe('Exfiltração');
    expect(resolveTatica('ROUBO-DE-SENHAS')).toBe('Acesso a credenciais');
    expect(KILL_CHAIN).toHaveLength(12);
  });
});
