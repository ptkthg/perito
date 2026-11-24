// Indicadores (IOC): "defang" para exibição segura e copiar sem risco de clique acidental.
// O valor real nunca é alterado na origem; defang é só apresentação (tecla D alterna).

const dots = (s: string) => s.replace(/\./g, '[.]');

/**
 * hxxp(s)://, [.] em domínios e IPs, [@] e [.] em e-mails. Arquivos e hashes ficam como estão.
 * `tipo` segue /iocs (ip, dominio, url, email, sha256, arquivo); sem tipo, detecta pelo formato.
 */
export function defang(valor: string, tipo?: string): string {
  const t = (tipo ?? '').toLowerCase();
  if (t === 'sha256' || t === 'hash' || t === 'arquivo' || t === 'file') return valor;
  if (t === 'url' || /^[a-z][a-z0-9+.-]*:\/\//i.test(valor)) {
    const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i.exec(valor);
    if (!m) return valor;
    const esquema = m[1]!.replace(/^http/i, (x) => (x[0] === 'H' ? 'HXXP' : 'hxxp')).replace(/^ftp/i, 'fxp');
    return `${esquema}://${dots(m[2]!)}${m[3]}`;
  }
  if (t === 'email' || /^[^@\s]+@[^@\s]+$/.test(valor)) {
    const [u, d] = valor.split('@') as [string, string];
    return `${u}[@]${dots(d)}`;
  }
  if (t === 'ip' || t === 'dominio' || t === 'domain' || /^[\w-]+(\.[\w-]+)+$/.test(valor)) return dots(valor);
  return valor;
}

const PRIVADO = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^127\./, /^169\.254\./, /^0\./];

/** IPv4 fora das faixas internas (RFC 1918, loopback, link-local). */
export function isExternalIp(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  return !PRIVADO.some((r) => r.test(ip));
}
