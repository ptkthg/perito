"""Grafo somente leitura de relações observadas na timeline construída."""
from __future__ import annotations

from urllib.parse import urlsplit

from .._network import is_external_ip
from ..schema import Event

_PORTS = {3389: 'rdp', 445: 'smb', 5985: 'winrm', 5986: 'winrm', 22: 'ssh'}
_MFA = {'user registered security info', 'admin registered security info'}


def _domain(value):
    if not value:
        return None
    return urlsplit(value if '://' in value else '//' + value).hostname


def _relation(ev, domains):
    """Origem, destino e tipo; relações sem as duas entidades são omitidas."""
    host = ev.host or ev.extra.get('src_host')
    if ev.event_type == 'email':
        return ('email', ev.extra.get('sender')), ('conta', ev.user), 'email'
    if ev.event_type == 'logon':
        source = ev.extra.get('src_host')
        if source and source != ev.host:
            kind = 'rdp' if str(ev.extra.get('logon_type')).lower() in ('10', 'remoteinteractive') else 'logon'
            return ('host', source), ('host', ev.host), kind
        if ev.outcome == 'success':
            return ('conta', ev.user), ('host', ev.host), 'logon'
    if ev.event_type in ('network', 'dns'):
        if ev.extra.get('observer') and not ev.extra.get('src_host'):
            return None
        if ev.event_type == 'network' and not is_external_ip(ev.dst_ip):
            kind = _PORTS.get(ev.dst_port)
            if kind and ev.extra.get('dst_host'):
                return ('host', host), ('host', ev.extra['dst_host']), kind
        if is_external_ip(ev.dst_ip):
            domain = domains.get(ev.dst_ip)
            target = ('dominio', domain) if domain else ('ip', ev.dst_ip)
            return ('host', host), target, 'rede_externa'
    if ev.event_type == 'signin':
        return ('ip', ev.src_ip), ('conta', ev.user), 'signin'
    if ev.event_type == 'audit':
        action = (ev.action or '').lower()
        if action in _MFA:
            return ('ip', ev.src_ip), ('conta', ev.user), 'mfa'
        if action == 'consent to application':
            targets = ev.extra.get('targets') or []
            return ('conta', ev.user), ('app', targets[0] if targets else None), 'consent'
    return None


def _label(edge, events):
    kind = edge['tipo']
    if kind == 'email':
        ev = events[edge['idxs'][0]]
        label = 'e-mail: ' + (ev.extra.get('subject') or 'sem assunto')
        attachment = ev.extra.get('attachment')
        return label + (f' ({attachment})' if attachment else '')
    if kind == 'rede_externa':
        size = edge['bytes_out']
        if size:
            unit, divisor = ('GB', 10**9) if size >= 10**9 else ('MB', 10**6)
            return f'enviou {size / divisor:.1f} {unit}'.replace('.', ',')
        return 'conexão externa'
    if kind == 'signin':
        denied = sum(str(events[i].extra.get('error_code')) == '500121'
                     and events[i].outcome == 'failure' for i in edge['idxs'])
        parts = []
        if denied:
            parts.append(f'{denied} MFA negados')
        other = edge['falha'] - denied
        if other:
            parts.append(f'{other} falhas')
        if edge['sucesso']:
            parts.append(f'{edge["sucesso"]} logins')
        return ', '.join(parts) or 'sign-in'
    if kind == 'mfa':
        return 'novo dispositivo MFA'
    if kind == 'consent':
        permissions = []
        for idx in edge['idxs']:
            details = events[idx].extra.get('details') or {}
            value = details.get('Permissions')
            if value and value not in permissions:
                permissions.append(value)
        return 'autorizou app' + (f' ({", ".join(permissions)})' if permissions else '')
    label = {'logon': 'logon', 'rdp': 'RDP', 'smb': 'SMB', 'winrm': 'WinRM', 'ssh': 'SSH'}[kind]
    return label + (' como ' + ', '.join(edge['contas']) if edge['contas'] else '')


def build_graph(events: list[Event], hosts_sem_edr: list[str]) -> dict:
    """Agrega entidades e relações sem modificar eventos nem reconstruir a timeline.

    Os índices sempre correspondem à lista recebida, inclusive quando eventos
    sem relação (por exemplo, processos) contribuem apenas para os nós.
    """
    domains = {}
    for ev in events:
        domain = _domain(ev.domain)
        if ev.dst_ip and domain:
            domains.setdefault(ev.dst_ip, domain)
    nodes, edges = {}, {}
    no_edr = set(hosts_sem_edr)

    def node(kind, value, ev, touched, *, outgoing=False):
        key = f'{kind}:{value}'
        column = {'email': 'entrada', 'conta': 'interno', 'host': 'interno',
                  'ip': 'entrada', 'dominio': 'saida', 'app': 'nuvem'}[kind]
        row = nodes.setdefault(key, dict(
            id=key, tipo=kind, rotulo=value, coluna=column,
            flags=dict(sem_edr=kind == 'host' and value in no_edr,
                       externo=kind == 'dominio' or (kind == 'ip' and is_external_ip(value)),
                       nuvem=kind == 'app', onprem=kind == 'host'),
            primeira=ev.ts_utc, ultima=ev.ts_utc, eventos=0, tecnicas=[], relevante=False))
        if outgoing:
            row['coluna'] = 'saida'
            if kind == 'dominio':
                row['ips'] = sorted(set(row.get('ips', [])) | {ev.dst_ip})
        if key not in touched:
            touched.add(key)
            row['eventos'] += 1
            row['primeira'] = min(row['primeira'], ev.ts_utc)
            row['ultima'] = max(row['ultima'], ev.ts_utc)
            if kind in ('host', 'conta'):
                row['tecnicas'] = sorted(set(row['tecnicas']) | set(ev.mitre))
                row['relevante'] |= bool(ev.mitre)
            if kind == 'conta':
                row['flags']['nuvem'] |= ev.source in ('entra_signin', 'entra_audit')
                row['flags']['onprem'] |= ev.event_type in ('logon', 'process') and bool(ev.host)
        return key

    for idx, ev in enumerate(events):
        touched = set()
        if ev.host:
            node('host', ev.host, ev, touched)
        if ev.user:
            node('conta', ev.user, ev, touched)
        relation = _relation(ev, domains)
        if relation is None:
            continue
        origin, target, kind = relation
        if not origin[1] or not target[1]:
            continue
        source = node(*origin, ev, touched)
        destination = node(*target, ev, touched, outgoing=kind == 'rede_externa')
        edge = edges.setdefault((source, destination, kind), dict(
            id=f'e{len(edges) + 1}', origem=source, destino=destination, tipo=kind,
            rotulo='', contas=[], primeira=ev.ts_utc, ultima=ev.ts_utc,
            contagem=0, sucesso=0, falha=0, bytes_out=0, volume_alto=False,
            tecnicas=[], raw_refs=[], idxs=[], suspeita=False))
        edge['primeira'] = min(edge['primeira'], ev.ts_utc)
        edge['ultima'] = max(edge['ultima'], ev.ts_utc)
        edge['contagem'] += 1
        edge['sucesso'] += ev.outcome == 'success'
        edge['falha'] += ev.outcome == 'failure'
        if ev.user:
            edge['contas'] = sorted(set(edge['contas']) | {ev.user})
        if kind == 'rede_externa':
            edge['bytes_out'] += ev.extra.get('bytes_out') or 0
        edge['volume_alto'] |= bool(ev.extra.get('volume_alto'))
        edge['tecnicas'] = sorted(set(edge['tecnicas']) | set(ev.mitre))
        if ev.raw_ref not in edge['raw_refs']:
            edge['raw_refs'].append(ev.raw_ref)
        edge['idxs'].append(idx)
        edge['suspeita'] |= bool(ev.mitre or ev.extra.get('volume_alto')) or (
            kind == 'signin' and ev.outcome == 'failure' and str(ev.extra.get('error_code')) == '500121')

    for edge in edges.values():
        edge['rotulo'] = _label(edge, events)
        if edge['suspeita']:
            nodes[edge['origem']]['relevante'] = True
            nodes[edge['destino']]['relevante'] = True
    path = [e['id'] for e in sorted(edges.values(), key=lambda e: e['primeira']) if e['suspeita']]
    return dict(nos=list(nodes.values()), arestas=list(edges.values()), caminho=path)


def relevant_graph(graph: dict) -> dict:
    """Mantém nós relevantes e uma única camada de vizinhos diretos."""
    seeds = {n['id'] for n in graph['nos'] if n['relevante']}
    kept = seeds.copy()
    for edge in graph['arestas']:
        if edge['origem'] in seeds or edge['destino'] in seeds:
            kept.update((edge['origem'], edge['destino']))
    return dict(nos=[n for n in graph['nos'] if n['id'] in kept],
                arestas=[e for e in graph['arestas'] if e['origem'] in kept and e['destino'] in kept],
                caminho=list(graph['caminho']))
