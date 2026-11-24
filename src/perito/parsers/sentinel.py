from pathlib import Path
from typing import Iterator

from perito.schema import Event, normalize_host, to_int
from . import defender, entra_audit, entra_signin
from ._io import event, get, iter_events, techniques
from ._winsec import map_windows_event


def map_record(rec, ref, source='sentinel'):
    table = get(rec, 'Type', default='desconhecido')
    if table.startswith('Device'):
        return defender.map_record(rec, ref, source)
    if table in ('SigninLogs', 'AADNonInteractiveUserSignInLogs'):
        return entra_signin.map_record(rec, ref, source)
    if table == 'AuditLogs':
        return entra_audit.map_record(rec, ref, source)
    fields = dict(event_type='other', extra={'table': table}, description=f'{table}: evento registrado')
    if table == 'SecurityEvent':
        fields = map_windows_event(rec, 'security')
        fields['host'] = get(rec, 'Computer')
        fields['extra']['table'] = table
    elif table == 'SecurityAlert':
        entity = get(rec, 'CompromisedEntity')
        host = entity if entity and '@' not in entity and ' ' not in entity and '://' not in entity else None
        fields.update(event_type='alert', host=host, description=get(rec, 'AlertName', default='Alerta Sentinel'), severity=str(get(rec, 'AlertSeverity', default='')).lower() or None, mitre=techniques(get(rec, 'Techniques')))
    elif table == 'CommonSecurityLog':
        action = str(get(rec, 'DeviceAction', default='')).lower()
        fields.update(event_type='network', description='', src_ip=get(rec, 'SourceIP'), dst_ip=get(rec, 'DestinationIP'), dst_port=to_int(get(rec, 'DestinationPort')), domain=get(rec, 'RequestURL', 'DestinationHostName'), action=get(rec, 'DeviceAction'), outcome='success' if action.startswith(('allow', 'accept')) else 'blocked' if action.startswith(('deny', 'drop', 'block')) else None)
        fields['extra'].update(bytes_out=to_int(get(rec, 'SentBytes')), bytes_in=to_int(get(rec, 'ReceivedBytes')), observer=normalize_host(get(rec, 'DeviceName')))
    return event(rec, ref, source, get(rec, 'TimeGenerated'), **fields)


def parse(path: Path) -> Iterator[Event]:
    yield from iter_events(path, map_record, 'sentinel')
