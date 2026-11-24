from pathlib import Path
from typing import Iterator

from perito.schema import Event, normalize_host, to_int
from ._io import event, get, iter_events
from ._winsec import map_windows_event


def map_record(rec, ref, source='splunk'):
    sourcetype = str(get(rec, 'sourcetype', 'source', default=''))
    lower = sourcetype.lower()
    fields = dict(event_type='other', host=get(rec, 'host'), extra={'sourcetype': sourcetype})
    if 'sysmon' in lower or 'wineventlog:security' in lower:
        fields.update(map_windows_event(rec, 'sysmon' if 'sysmon' in lower else 'security'))
        fields['extra']['sourcetype'] = sourcetype
    elif lower.startswith(('pan:', 'cisco:asa', 'fortigate', 'fgt_', 'squid', 'zscaler')) or (get(rec, 'src_ip') and get(rec, 'dest_ip')):
        action = str(get(rec, 'action', default='')).lower()
        fields.update(event_type='network', host=None, src_ip=get(rec, 'src_ip', 'src'), dst_ip=get(rec, 'dest_ip', 'dest'), dst_port=to_int(get(rec, 'dest_port')), domain=get(rec, 'url', 'dest_host'), user=get(rec, 'user'), action=get(rec, 'action'), outcome='success' if action in ('allowed', 'allow', 'accept') else 'blocked' if action in ('blocked', 'deny', 'drop') or action.startswith('reset-') else None)
        fields['extra'].update(observer=normalize_host(get(rec, 'host')), bytes_out=to_int(get(rec, 'bytes_out')), bytes_in=to_int(get(rec, 'bytes_in')), app=get(rec, 'app'))
    if fields['event_type'] in ('network', 'dns') and not fields.get('process'):
        fields['extra']['observer'] = fields['extra'].get('observer') or normalize_host(fields.get('host'))
        fields['host'] = None
    return event(rec, ref, source, get(rec, '_time'), **fields)


def parse(path: Path) -> Iterator[Event]:
    yield from iter_events(path, map_record, 'splunk')
