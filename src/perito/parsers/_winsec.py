"""Mapeamento comum de Windows Security e Sysmon."""
import re

from perito.schema import normalize_ip, normalize_process, to_int
from ._io import get


def map_windows_event(rec, provider):
    eid = to_int(get(rec, 'EventID', 'EventCode'))
    target = get(rec, 'TargetUserName', 'Account_Name', 'User')
    subject = get(rec, 'SubjectUserName', 'Account')
    image = get(rec, 'NewProcessName', 'New_Process_Name', 'Image')
    fields = dict(event_type='other', action=f'sysmon:{eid}' if provider == 'sysmon' else str(eid), user=target or subject, extra={'event_id': eid})
    extra = fields['extra']
    if provider == 'security':
        if eid in (4624, 4625, 4634, 4647, 4648, 4672):
            fields.update(event_type='logon', src_ip=get(rec, 'IpAddress', 'Source_Network_Address', 'SourceIp'))
            extra.update(logon_type=to_int(get(rec, 'LogonType', 'Logon_Type')), workstation=get(rec, 'WorkstationName', 'Workstation_Name'))
            if eid in (4624, 4625):
                fields['outcome'] = 'success' if eid == 4624 else 'failure'
            elif eid in (4634, 4647):
                fields['action'] = 'logoff'
            elif eid == 4648:
                fields['description'] = 'Logon com credenciais explícitas'
            else:
                fields.update(user=subject, description='privilégios especiais atribuídos')
                extra['privileges'] = get(rec, 'PrivilegeList')
        elif eid == 4688:
            fields.update(event_type='process', user=subject or target)
        elif eid in (4698, 4702):
            fields['event_type'] = 'scheduled_task'
            extra['task_name'] = get(rec, 'TaskName')
        elif eid in (7045, 4697):
            fields['event_type'] = 'service'
            extra.update(service_name=get(rec, 'ServiceName'), image_path=get(rec, 'ImagePath', 'ServiceFileName'))
        elif eid in (4720, 4722, 4724, 4728, 4732, 4738, 4756, 1102, 104):
            fields['event_type'] = 'audit'
            if eid in (1102, 104):
                fields.update(user=subject or target, description='log de auditoria limpo')
    else:
        fields.update(process=image, src_ip=get(rec, 'SourceIp'))
        if eid == 1:
            fields['event_type'] = 'process'
            match = re.search(r'(?:^|[,;])\s*SHA256=([^,;]+)', str(get(rec, 'Hashes', default='')), re.I)
            fields['sha256'] = match.group(1).strip() if match else None
        elif eid == 3:
            fields.update(event_type='network', dst_ip=get(rec, 'DestinationIp'), dst_port=to_int(get(rec, 'DestinationPort')), domain=get(rec, 'DestinationHostname'))
            extra['host_ip'] = normalize_ip(get(rec, 'SourceIp'))
        elif eid == 10:
            fields['process'] = get(rec, 'SourceImage')
            extra['target_process'] = normalize_process(get(rec, 'TargetImage'))
        elif eid == 11:
            fields.update(event_type='file', file_path=get(rec, 'TargetFilename'))
        elif eid in (12, 13, 14):
            fields['event_type'] = 'registry'
            extra['registry_key'] = get(rec, 'TargetObject')
        elif eid == 22:
            results = re.findall(r'(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F]*:[0-9a-fA-F:]+', str(get(rec, 'QueryResults', default='')))
            fields.update(event_type='dns', domain=get(rec, 'QueryName'), dst_ip=results[0] if results else None)
    if fields['event_type'] == 'process':
        fields.update(process=image, parent=get(rec, 'ParentProcessName', 'Creator_Process_Name', 'ParentImage'), cmdline=get(rec, 'CommandLine', 'Process_Command_Line'), file_path=image)
    return fields
