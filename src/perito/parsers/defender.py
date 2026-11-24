from pathlib import Path
from typing import Iterator

from perito.schema import Event, normalize_host, normalize_ip, normalize_process, to_int
from ._io import event, get, iter_events, structured, techniques


def map_record(rec, ref, source='defender'):
    action = get(rec, 'ActionType', default='')
    table = get(rec, 'TableName', 'Type', '$table')
    if not table:
        table = ('EmailEvents' if get(rec, 'SenderFromAddress') else
                 'DeviceRegistryEvents' if get(rec, 'RegistryKey') else
                 'DeviceLogonEvents' if get(rec, 'LogonType') else
                 'DeviceNetworkEvents' if get(rec, 'RemoteIP') and action.startswith('Connection') else
                 'DeviceProcessEvents' if action == 'ProcessCreated' else
                 'DeviceFileEvents' if action.startswith('File') else 'DeviceEvents')
    extra = {'table': table}
    fields = dict(event_type='other', host=get(rec, 'DeviceName'), user=get(rec, 'AccountName', 'InitiatingProcessAccountName'), action=action, extra=extra)
    process = get(rec, 'InitiatingProcessFileName')
    if table == 'DeviceProcessEvents':
        fields.update(event_type='process', process=get(rec, 'FileName'), parent=process, cmdline=get(rec, 'ProcessCommandLine'), file_path=get(rec, 'FolderPath'), sha256=get(rec, 'SHA256'))
    elif table == 'DeviceNetworkEvents':
        fields.update(event_type='network', process=process, cmdline=get(rec, 'InitiatingProcessCommandLine'), src_ip=get(rec, 'LocalIP'), dst_ip=get(rec, 'RemoteIP'), dst_port=to_int(get(rec, 'RemotePort')), domain=get(rec, 'RemoteUrl'))
        fields['outcome'] = 'success' if action == 'ConnectionSuccess' else 'failure' if action.endswith('Failed') else 'blocked' if action.endswith('Blocked') else None
        extra['host_ip'] = normalize_ip(get(rec, 'LocalIP'))
    elif table == 'DeviceFileEvents':
        fields.update(event_type='file', file_path=get(rec, 'FolderPath'), process=process, sha256=get(rec, 'SHA256'))
    elif table == 'DeviceRegistryEvents':
        fields.update(event_type='registry', process=process)
        extra.update(registry_key=get(rec, 'RegistryKey'), registry_value_name=get(rec, 'RegistryValueName'), registry_value_data=get(rec, 'RegistryValueData'))
    elif table == 'DeviceLogonEvents':
        fields.update(event_type='logon', src_ip=get(rec, 'RemoteIP'), outcome='success' if action == 'LogonSuccess' else 'failure' if action == 'LogonFailed' else None)
        extra['logon_type'] = get(rec, 'LogonType')
    elif table == 'EmailEvents':
        fields.update(event_type='email', user=get(rec, 'RecipientEmailAddress'), src_ip=get(rec, 'RemoteIP', 'SenderIPv4'), sha256=get(rec, 'SHA256'), action=get(rec, 'DeliveryAction', 'ActionType'), description=f'E-mail de {get(rec, "SenderFromAddress")} para {get(rec, "RecipientEmailAddress")}: {get(rec, "Subject", default="")}')
        extra.update(sender=get(rec, 'SenderFromAddress'), subject=get(rec, 'Subject'), attachment=get(rec, 'FileName'))
    elif table in ('AlertInfo', 'AlertEvidence'):
        fields.update(event_type='alert', description=get(rec, 'Title', default='Alerta Defender'), severity=str(get(rec, 'Severity', default='')).lower() or None, mitre=techniques(get(rec, 'AttackTechniques')))
    else:
        additional = structured(get(rec, 'AdditionalFields'), {})
        fields['process'] = process
        extra['additional_fields'] = additional
        if action in ('ScheduledTaskCreated', 'ScheduledTaskUpdated'):
            fields['event_type'] = 'scheduled_task'
            extra.update(task_name=get(additional, 'TaskName'), task_content=get(additional, 'TaskContent'))
        elif action == 'ServiceInstalled':
            fields['event_type'] = 'service'
            extra['service_name'] = get(additional, 'ServiceName')
        else:
            extra['target_process'] = normalize_process(get(rec, 'FileName'))
            fields['description'] = f'{process or "Processo"} → {action} em {extra["target_process"] or "alvo desconhecido"}'
    if fields['event_type'] in ('network', 'dns') and not fields.get('process'):
        extra['observer'] = normalize_host(fields.pop('host', None))
    return event(rec, ref, source, get(rec, 'Timestamp', 'TimeGenerated'), **fields)


def parse(path: Path) -> Iterator[Event]:
    yield from iter_events(path, map_record, 'defender')
