import { describe, expect, it } from 'vitest';
import { daySeparator, formatBytes, resolveSource, resolveType, shortHash, shortPhase, splitTs, truncateMiddle } from './format';
import { defang, isExternalIp } from './ioc';
import { expandRefs, resolveRefs, splitRefs } from './refs';
import { ev } from './test-events';

describe('truncateMiddle', () => {
  it('preserva início e fim com … no meio', () => {
    const s = 'rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump 624 C:\\Users\\Public\\l.dmp full';
    const t = truncateMiddle(s, 30);
    expect(Array.from(t)).toHaveLength(30);
    expect(t.startsWith('rundll32.exe')).toBe(true);
    expect(t.endsWith('full')).toBe(true);
    expect(t).toContain('…');
  });
  it('não mexe no que cabe; limites', () => {
    expect(truncateMiddle('curto', 10)).toBe('curto');
    expect(truncateMiddle('abcdef', 1)).toBe('…');
    expect(truncateMiddle('abcdef', 0)).toBe('');
  });
});

describe('tempo', () => {
  it('splitTs separa ms sem converter fuso', () => {
    expect(splitTs('2026-11-10T13:15:30.660Z')).toEqual({ hms: '13:15:30', ms: '.660' });
    expect(splitTs('2026-11-10T13:15:30Z')).toEqual({ hms: '13:15:30', ms: '' });
  });
  it('separador de dia com dia da semana', () => {
    expect(daySeparator('2026-11-10')).toBe('── 2026-11-10 TER ──');
  });
});

describe('bytes e rótulos', () => {
  it('formatBytes em base 1024 com vírgula', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(2_576_980_378)).toBe('2,4 GB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(null)).toBe('—');
  });
  it('hash abreviado, códigos de fonte/tipo e fase', () => {
    expect(shortHash('a3f9c2e1aaaaaaaaaaaaaaaaaaaaaaaaaaaa7d04')).toBe('a3f9c2e1…7d04');
    expect(resolveSource('ELA')).toBe('elastic');
    expect(resolveType('task')).toBe('scheduled_task');
    expect(shortPhase('Detectar / Identification')).toBe('DETECT');
  });
});

describe('defang', () => {
  it('url, domínio, ip e e-mail; hash intocado', () => {
    expect(defang('https://cdn-update.example-cdn.net/a.ps1', 'url')).toBe('hxxps://cdn-update[.]example-cdn[.]net/a.ps1');
    expect(defang('bkp.example-storage.net', 'dominio')).toBe('bkp[.]example-storage[.]net');
    expect(defang('203.0.113.45', 'ip')).toBe('203[.]0[.]113[.]45');
    expect(defang('faturas@pagamentos-fornecedor.example', 'email')).toBe('faturas[@]pagamentos-fornecedor[.]example');
    expect(defang('a3f9c2e1', 'sha256')).toBe('a3f9c2e1');
    expect(defang('C:\\ProgramData\\rc\\rclone.exe', 'arquivo')).toBe('C:\\ProgramData\\rc\\rclone.exe');
  });
  it('ip externo × interno', () => {
    expect(isExternalIp('203.0.113.45')).toBe(true);
    expect(isExternalIp('10.10.20.23')).toBe(false);
    expect(isExternalIp('172.20.1.1')).toBe(false);
    expect(isExternalIp('172.32.1.1')).toBe(true);
  });
});

describe('refs de evidência', () => {
  it('expande intervalo e lista; ignora ip:porta', () => {
    expect(expandRefs('defender_advanced_hunting.csv:15-17; entra_signin.json#3')).toEqual([
      'defender_advanced_hunting.csv:15',
      'defender_advanced_hunting.csv:16',
      'defender_advanced_hunting.csv:17',
      'entra_signin.json#3',
    ]);
    expect(expandRefs('conexão para 203.0.113.45:443 e host.net:443')).toEqual([]);
  });
  it('resolve refs e IDs de achado para idx', () => {
    const evs = [ev({ idx: 5, raw_ref: 'd.csv:15' }), ev({ idx: 6, raw_ref: 'd.csv:16' }), ev({ idx: 9, raw_ref: 's.json#2' })];
    const achados = [{ id: 'A6', utc: '', host: null, conta: null, achado: '', attack: [], evidencia: ['s.json#2'], linha: 1 }];
    expect(resolveRefs('ver d.csv:15-16 e A6', evs, achados)).toEqual([5, 6, 9]);
  });
  it('splitRefs separa texto, ref e achado', () => {
    expect(splitRefs('A2 (d.csv:7-9) ok').map((p) => p.tipo)).toEqual(['achado', 'texto', 'ref', 'texto']);
  });
});
