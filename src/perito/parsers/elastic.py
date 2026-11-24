from pathlib import Path
from typing import Iterator

from perito.schema import Event, normalize_host, to_int
from ._io import event, get, iter_events, techniques


def map_record(rec, ref, source='elastic'):
    categories = get(rec, 'event.category', default=[])
    if isinstance(categories, str):
        categories = [categories]
    fields = dict(event_type='other', host=get(rec, 'host.name'), user=get(rec, 'user.name'), action=get(rec, 'event.action'), outcome=get(rec, 'event.outcome'), process=get(rec, 'process.name'), extra={})
    extra = fields['extra']
    if get(rec, 'kibana.alert.rule.name'):
        ids = techniques(get(rec, 'threat.technique.id')) + techniques(get(rec, 'threat.technique.subtechnique.id'))
        for threat in get(rec, 'threat', default=[]) if isinstance(get(rec, 'threat'), list) else []:
            for technique in get(threat, 'technique', default=[]):
                ids += techniques([get(technique, 'id')])
                ids += [get(sub, 'id') for sub in get(technique, 'subtechnique', default=[]) if get(sub, 'id')]
        fields.update(event_type='alert', description=get(rec, 'kibana.alert.rule.name'), severity=get(rec, 'kibana.alert.severity'), mitre=sorted(set(ids)))
    elif 'process' in categories:
        fields.update(event_type='process', parent=get(rec, 'process.parent.name'), cmdline=get(rec, 'process.command_line'), file_path=get(rec, 'process.executable'), sha256=get(rec, 'process.hash.sha256'))
    elif 'network' in categories:
        fields.update(event_type='network', src_ip=get(rec, 'source.ip'), dst_ip=get(rec, 'destination.ip'), dst_port=to_int(get(rec, 'destination.port')), domain=get(rec, 'destination.domain', 'url.domain'))
        if get(rec, 'dns.question.name'):
            ips = get(rec, 'dns.resolved_ip', default=[])
            fields.update(event_type='dns', domain=get(rec, 'dns.question.name'), dst_ip=ips[0] if isinstance(ips, list) and ips else ips or None)
        if not fields['process']:
            extra['observer'] = normalize_host(fields['host'])
            fields['host'] = None
    elif 'authentication' in categories:
        fields.update(event_type='logon', src_ip=get(rec, 'source.ip'))
    elif 'file' in categories:
        fields.update(event_type='file', file_path=get(rec, 'file.path'), sha256=get(rec, 'file.hash.sha256'))
    elif 'registry' in categories:
        fields['event_type'] = 'registry'
        extra['registry_key'] = get(rec, 'registry.path')
    elif 'iam' in categories:
        fields['event_type'] = 'audit'
    return event(rec, ref, source, get(rec, '@timestamp'), **fields)


def parse(path: Path) -> Iterator[Event]:
    yield from iter_events(path, map_record, 'elastic')
