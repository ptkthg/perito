"""Timeline, correlação e candidatos a IOC com rastreabilidade das fontes."""
from __future__ import annotations

import copy
import csv
import io
import json
from collections import Counter, defaultdict, deque
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from ._network import is_external_ip
from .case import Case
from .mitre import annotate
from .schema import Event, is_private_ip, normalize_host, normalize_user, parse_ts

DOMINIOS_IGNORADOS = ('office.com', 'microsoft.com', 'windows.net', 'live.com')
CSV_HEADER = 'ts_utc,source,event_type,host,user,src_ip,dst_ip,dst_port,domain,process,parent,cmdline,file_path,sha256,action,outcome,severity,mitre,description,raw_ref,ts_original,src_host,dst_host,corroborado_por'.split(',')


def load_events(case: Case) -> list[Event]:
    events = []
    for path in sorted(case.normalized_dir.glob('*.jsonl')):
        for line, text in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            if text.strip():
                try:
                    events.append(Event.from_dict(json.loads(text)))
                except (ValueError, TypeError) as exc:
                    raise ValueError(f'Normalizado inválido em {path.name}:{line}: {exc}') from exc
    return events


def ip_host_map(events) -> dict[str, str]:
    mapping = {}
    for ev in events:
        ip = ev.extra.get('host_ip')
        if ip and ev.host and is_private_ip(ip) and not is_external_ip(ip):
            mapping.setdefault(ip, ev.host)
    return mapping


def _correlation_key(ev):
    host = ev.host or ev.extra.get('src_host')
    if ev.event_type == 'process':
        key = (host, ev.process)
    elif ev.event_type == 'logon':
        key = (host, ev.user)
    elif ev.event_type in ('network', 'dns'):
        key = (ev.src_ip or host, ev.dst_ip or ev.domain)
    elif ev.event_type == 'audit' and ev.action in ('1102', '104'):
        key = (host, ev.action)
    else:
        return None
    return (ev.event_type, *key) if all(key) else None


def build(events: list[Event]) -> list[Event]:
    ordered = sorted(copy.deepcopy(events), key=lambda e: (e.ts_utc, e.source, e.raw_ref))
    unique = {}
    for ev in ordered:
        key = ev.dedupe_key()
        if key in unique:
            original = unique[key]
            original.extra['duplicatas'] = original.extra.get('duplicatas', 0) + 1
        else:
            unique[key] = ev
    result = list(unique.values())
    mapping = ip_host_map(result)
    windows = defaultdict(deque)
    for ev in result:
        for field in ('src_host', 'dst_host', 'volume_alto', 'corroborado_por'):
            ev.extra.pop(field, None)
        if ev.src_ip in mapping and mapping[ev.src_ip] != ev.host:
            ev.extra['src_host'] = mapping[ev.src_ip]
        if ev.dst_ip in mapping:
            ev.extra['dst_host'] = mapping[ev.dst_ip]
        if ev.event_type == 'network' and (ev.extra.get('bytes_out') or 0) >= 100 * 1024**2 and is_external_ip(ev.dst_ip):
            ev.extra['volume_alto'] = True
        annotate(ev)
        key = _correlation_key(ev)
        if key is None:
            continue
        timestamp = datetime.fromisoformat(ev.ts_utc.replace('Z', '+00:00')).timestamp()
        window = windows[key]
        while window and timestamp - window[0][0] > 2:
            window.popleft()
        for _, other in window:
            if other.source != ev.source:
                for first, second in ((ev, other), (other, ev)):
                    refs = first.extra.setdefault('corroborado_por', [])
                    if second.raw_ref not in refs:
                        refs.append(second.raw_ref)
        window.append((timestamp, ev))
    return result


def filter_events(events, *, host=None, user=None, ip=None, sha256=None, domain=None, de=None, ate=None, fonte=None, tipo=None, texto=None) -> list[Event]:
    host, user = normalize_host(host), normalize_user(user)
    start, end = parse_ts(de) if de else None, parse_ts(ate) if ate else None
    sources = {s.strip().lower() for s in fonte.split(',')} if fonte else None
    types = {s.strip().lower() for s in tipo.split(',')} if tipo else None
    result = []
    for ev in events:
        if host and host not in (ev.host, ev.extra.get('src_host'), ev.extra.get('dst_host'), ev.extra.get('observer')):
            continue
        if user and user != ev.user:
            continue
        if ip and ip not in (ev.src_ip, ev.dst_ip, ev.extra.get('host_ip')):
            continue
        if sha256 and sha256.lower() != (ev.sha256 or '').lower():
            continue
        if domain and domain.lower() != (ev.domain or '').lower():
            continue
        if (start and ev.ts_utc < start) or (end and ev.ts_utc > end):
            continue
        if (sources and ev.source.lower() not in sources) or (types and ev.event_type.lower() not in types):
            continue
        if texto and texto.lower() not in ' '.join(v or '' for v in (ev.description, ev.cmdline, ev.file_path, ev.domain)).lower():
            continue
        result.append(ev)
    return result


def _entity_values(ev):
    return {
        'host': {ev.host, ev.extra.get('src_host'), ev.extra.get('dst_host')},
        'user': {ev.user}, 'ip': {ev.src_ip, ev.dst_ip, ev.extra.get('host_ip')},
        'domain': {ev.domain}, 'sha256': {ev.sha256}, 'process': {ev.process},
    }


def entities(events) -> dict[str, dict[str, dict]]:
    result = {key: {} for key in ('host', 'user', 'ip', 'domain', 'sha256', 'process')}
    for ev in events:
        for kind, values in _entity_values(ev).items():
            for value in values - {None, ''}:
                info = result[kind].setdefault(value, {'primeira': ev.ts_utc, 'ultima': ev.ts_utc, 'eventos': 0, 'fontes': []})
                info['primeira'] = min(info['primeira'], ev.ts_utc)
                info['ultima'] = max(info['ultima'], ev.ts_utc)
                info['eventos'] += 1
                info['fontes'] = sorted(set(info['fontes']) | {ev.source})
    return result


def coverage(events) -> dict:
    sources = {}
    edr = set()
    for ev in events:
        row = sources.setdefault(ev.source, {'eventos': 0, 'primeiro': ev.ts_utc, 'ultimo': ev.ts_utc})
        row['eventos'] += 1
        row['primeiro'] = min(row['primeiro'], ev.ts_utc)
        row['ultimo'] = max(row['ultimo'], ev.ts_utc)
        if ev.host and (ev.source == 'defender' or (ev.source == 'elastic' and ev.event_type == 'process')):
            edr.add(ev.host)
    timestamps = [ev.ts_utc for ev in events]
    return dict(por_fonte=sources, por_tipo=dict(Counter(ev.event_type for ev in events)), tecnicas=dict(Counter(t for ev in events for t in ev.mitre)), hosts_sem_edr=sorted(set(entities(events)['host']) - edr), janela={'primeiro': min(timestamps, default=None), 'ultimo': max(timestamps, default=None)})


def _domain(value):
    if not value:
        return None
    return urlsplit(value if '://' in value else '//' + value).hostname


def ioc_candidates(events) -> list[dict]:
    candidates = {}
    for ev in sorted(events, key=lambda e: (e.ts_utc, e.source, e.raw_ref)):
        pairs = [('ip', ip) for ip in (ev.src_ip, ev.dst_ip) if is_external_ip(ip)]
        domain = _domain(ev.domain)
        if domain and not domain.endswith('.local') and not any(domain == d or domain.endswith('.' + d) for d in DOMINIOS_IGNORADOS):
            # Endereços em RequestURL não se tornam domínios candidatos.
            import ipaddress
            try:
                ipaddress.ip_address(domain)
            except ValueError:
                pairs.append(('dominio', domain))
        path = ev.file_path or ev.extra.get('attachment') or ev.process or ''
        trusted = str(path).lower().startswith(('c:\\windows\\', 'c:\\program files\\', 'c:\\program files (x86)\\'))
        if ev.sha256 and ev.event_type in ('process', 'file', 'email') and not trusted:
            pairs.append(('sha256', ev.sha256))
        if ev.file_path and any(s in ev.file_path.lower() for s in ('\\appdata\\', '\\programdata\\', '\\users\\public\\', '\\temp\\')):
            pairs.append(('arquivo', ev.file_path))
        if ev.event_type == 'email' and ev.extra.get('sender'):
            pairs.append(('email', ev.extra['sender']))
        for kind, value in set(pairs):
            key = (kind, value)
            row = candidates.setdefault(key, dict(tipo=kind, valor=value, primeira_vez_utc=ev.ts_utc, ultima_vez_utc=ev.ts_utc, fonte='', contexto=ev.description[:120], confianca='candidato'))
            row['ultima_vez_utc'] = ev.ts_utc
            row['fonte'] = ';'.join(sorted(set(filter(None, row['fonte'].split(';'))) | {ev.source}))
    return [candidates[key] for key in sorted(candidates)]


def md_cell(value) -> str:
    return str(value or '').replace('|', '\\|').replace('\r', ' ').replace('\n', ' ')


def render_md(events, limite: int | None = None) -> str:
    lines = ['[LIMITAÇÃO] ATT&CK automático é sugestão; requer confirmação do analista.', '', '| UTC | Fonte | Host | Conta | Evento | ATT&CK | Ref |', '|---|---|---|---|---|---|---|']
    for ev in events[:limite] if limite is not None else events:
        host = ev.host or (str(ev.extra['src_host']) + '*' if ev.extra.get('src_host') else f'(obs: {ev.extra["observer"]})' if ev.extra.get('observer') else '')
        description = '[EVIDÊNCIA] ' + ev.description
        if ev.cmdline:
            description += ' · ' + (ev.cmdline[:119] + '…' if len(ev.cmdline) > 120 else ev.cmdline)
        if ev.extra.get('corroborado_por'):
            description += f' ⧉{len(ev.extra["corroborado_por"])}'
        if ev.extra.get('volume_alto'):
            description += ' ⚠ volume'
        lines.append('| ' + ' | '.join(md_cell(v) for v in (ev.ts_utc, ev.source, host, ev.user, description, ';'.join(ev.mitre), ev.raw_ref)) + ' |')
    return '\n'.join(lines) + '\n'


def render_csv(events) -> str:
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=CSV_HEADER)
    writer.writeheader()
    for ev in events:
        row = ev.to_dict()
        row.update({k: ev.extra.get(k) for k in ('src_host', 'dst_host', 'corroborado_por')})
        writer.writerow({k: ';'.join(row[k]) if isinstance(row.get(k), list) else row.get(k) for k in CSV_HEADER})
    return output.getvalue()


def write_outputs(case: Case, events: list[Event]) -> dict[str, Path]:
    case.timeline_dir.mkdir(parents=True, exist_ok=True)
    contents = {'jsonl': ''.join(ev.to_json() + '\n' for ev in events), 'csv': render_csv(events), 'md': render_md(events)}
    paths = {}
    for kind, content in contents.items():
        path = case.timeline_dir / f'timeline.{kind}'
        path.write_text(content, encoding='utf-8', newline='')
        paths[kind] = path
    return paths
