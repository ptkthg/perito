from pathlib import Path
from typing import Iterator

from perito.schema import Event, normalize_host, normalize_ip, to_int
from ._io import event, get, iter_events, techniques
from ._winsec import map_windows_event


def map_record(rec, ref, source='wazuh'):
    level = to_int(get(rec, 'rule.level')) or 0
    groups = get(rec, 'rule.groups', default=[])
    fields = dict(event_type='alert', host=get(rec, 'agent.name'), extra={})
    if get(rec, 'data.win.system.eventID') is not None:
        windows = dict(get(rec, 'data.win.eventdata', default={}))
        windows['EventID'] = get(rec, 'data.win.system.eventID')
        provider = str(get(rec, 'data.win.system.providerName', default=''))
        fields.update(map_windows_event(windows, 'sysmon' if 'sysmon' in provider.lower() else 'security'))
        fields['description'] = f'[Wazuh {get(rec, "rule.id")}] {get(rec, "rule.description", default="Alerta")}'
    else:
        fields['description'] = get(rec, 'rule.description', default='Alerta Wazuh')
        if 'authentication_success' in groups or 'authentication_failed' in groups:
            fields.update(event_type='logon', user=get(rec, 'data.dstuser'), src_ip=get(rec, 'data.srcip'), outcome='success' if 'authentication_success' in groups else 'failure')
    fields.update(mitre=techniques(get(rec, 'rule.mitre.id')), severity='informational' if level <= 3 else 'low' if level <= 7 else 'medium' if level <= 11 else 'high' if level <= 14 else 'critical')
    fields['extra'].update(host_ip=normalize_ip(get(rec, 'agent.ip')), rule_id=get(rec, 'rule.id'), rule_level=level, rule_description=get(rec, 'rule.description'), rule_groups=groups)
    if str(get(rec, 'agent.id')) == '000':
        fields.update(host=None, src_ip=get(rec, 'data.srcip'))
    if fields['event_type'] in ('network', 'dns') and not fields.get('process'):
        fields['extra']['observer'] = normalize_host(get(rec, 'agent.name'))
        fields['host'] = None
    return event(rec, ref, source, get(rec, 'timestamp'), **fields)


def parse(path: Path) -> Iterator[Event]:
    yield from iter_events(path, map_record, 'wazuh')
