"""Sugestões ATT&CK; a confirmação pertence ao analista."""
import json
import re

from ._network import is_external_ip
from .schema import Event

TECHNIQUES: dict[str, tuple[str, str]] = {
    'T1566.001': ('Spearphishing Attachment', 'Acesso inicial'),
    'T1566.002': ('Spearphishing Link', 'Acesso inicial'),
    'T1204.002': ('Malicious File', 'Execução'),
    'T1059.001': ('PowerShell', 'Execução'),
    'T1059.003': ('Windows Command Shell', 'Execução'),
    'T1059.005': ('Visual Basic', 'Execução'),
    'T1027': ('Obfuscated Files or Information', 'Evasão de defesa'),
    'T1218.005': ('Mshta', 'Evasão de defesa'),
    'T1218.010': ('Regsvr32', 'Evasão de defesa'),
    'T1218.011': ('Rundll32', 'Evasão de defesa'),
    'T1105': ('Ingress Tool Transfer', 'Comando e controle'),
    'T1053.005': ('Scheduled Task', 'Persistência'),
    'T1543.003': ('Windows Service', 'Persistência'),
    'T1547.001': ('Registry Run Keys / Startup Folder', 'Persistência'),
    'T1003.001': ('LSASS Memory', 'Acesso a credenciais'),
    'T1003.002': ('Security Account Manager', 'Acesso a credenciais'),
    'T1003.003': ('NTDS', 'Acesso a credenciais'),
    'T1021.001': ('Remote Desktop Protocol', 'Movimentação lateral'),
    'T1021.002': ('SMB/Windows Admin Shares', 'Movimentação lateral'),
    'T1021.006': ('Windows Remote Management', 'Movimentação lateral'),
    'T1569.002': ('Service Execution', 'Execução'),
    'T1567.002': ('Exfiltration to Cloud Storage', 'Exfiltração'),
    'T1070.001': ('Clear Windows Event Logs', 'Evasão de defesa'),
    'T1490': ('Inhibit System Recovery', 'Impacto'),
    'T1033': ('System Owner/User Discovery', 'Descoberta'),
    'T1069': ('Permission Groups Discovery', 'Descoberta'),
    'T1482': ('Domain Trust Discovery', 'Descoberta'),
    'T1018': ('Remote System Discovery', 'Descoberta'),
    'T1621': ('Multi-Factor Authentication Request Generation', 'Acesso a credenciais'),
    'T1078': ('Valid Accounts', 'Acesso inicial'),
    'T1078.002': ('Domain Accounts', 'Acesso inicial'),
    'T1078.004': ('Cloud Accounts', 'Acesso inicial'),
    'T1110': ('Brute Force', 'Acesso a credenciais'),
    'T1110.003': ('Password Spraying', 'Acesso a credenciais'),
    'T1098.005': ('Device Registration', 'Persistência'),
    'T1528': ('Steal Application Access Token', 'Acesso a credenciais'),
    'T1098.003': ('Additional Cloud Roles', 'Persistência'),
    'T1098.001': ('Additional Cloud Credentials', 'Persistência'),
    'T1564.008': ('Email Hiding Rules', 'Evasão de defesa'),
    'T1071.001': ('Web Protocols', 'Comando e controle'),
    'T1041': ('Exfiltration Over C2 Channel', 'Exfiltração'),
    'T1048': ('Exfiltration Over Alternative Protocol', 'Exfiltração'),
}


def suggest(ev: Event) -> list[str]:
    process = (ev.process or '').lower()
    parent = (ev.parent or '').lower()
    command = (ev.cmdline or '').lower()
    action = (ev.action or '').lower()
    extra = json.dumps(ev.extra, ensure_ascii=False).lower()
    text = ' '.join((process, parent, command, action, (ev.file_path or '').lower(), extra))
    found = set()

    def add(condition, *ids):
        if condition:
            found.update(ids)

    attachment = str(ev.extra.get('attachment') or '').lower()
    add(ev.event_type == 'email' and attachment.endswith(('.xlsm', '.xlsb', '.docm', '.doc', '.xls', '.iso', '.img', '.lnk', '.zip', '.rar', '.html', '.htm', '.one', '.js', '.vbs')), 'T1566.001')
    add(ev.event_type == 'email' and not attachment and (ev.extra.get('urls') or ev.extra.get('url')), 'T1566.002')
    office = {'winword.exe', 'excel.exe', 'powerpnt.exe', 'outlook.exe', 'onenote.exe', 'msaccess.exe'}
    shells = {'powershell.exe', 'pwsh.exe', 'cmd.exe', 'wscript.exe', 'cscript.exe', 'mshta.exe', 'rundll32.exe', 'regsvr32.exe', 'certutil.exe'}
    # Técnicas de execução valem só para o processo CRIADO (event_type process). Em eventos de arquivo
    # ou rede, `process` é o iniciador, e atribuir T1059 ali duplicaria a técnica em cada efeito colateral.
    is_proc = ev.event_type == 'process'
    add(is_proc and parent in office and process in shells, 'T1204.002')
    powershell = is_proc and process in ('powershell.exe', 'pwsh.exe', 'powershell', 'pwsh')
    add(powershell, 'T1059.001')
    add(powershell and (re.search(r'-(?:enc(?:odedcommand)?|e)(?:\s|$)', command) or 'frombase64string' in command), 'T1027')
    add(is_proc and process == 'cmd.exe' and command, 'T1059.003')
    add(is_proc and process in ('wscript.exe', 'cscript.exe'), 'T1059.005')
    add(is_proc and process == 'mshta.exe', 'T1218.005')
    add(is_proc and process == 'regsvr32.exe', 'T1218.010')
    add(is_proc and process == 'rundll32.exe' and command and 'comsvcs' not in command, 'T1218.011')
    add(is_proc and (any(term in text for term in ('downloadstring', 'downloadfile', 'invoke-webrequest', 'iwr ', 'wget ', 'curl ', 'start-bitstransfer')) or ('certutil' in text and '-urlcache' in text) or bool(re.search(r'bitsadmin(?:\.exe)?\s+/transfer', text))), 'T1105')
    # Ferramenta gravada em disco por um interpretador ou downloader (ex.: powershell gravando updater.exe).
    downloaders = {'powershell.exe', 'pwsh.exe', 'cmd.exe', 'certutil.exe', 'bitsadmin.exe', 'mshta.exe', 'wscript.exe', 'cscript.exe', 'curl.exe', 'rundll32.exe', 'regsvr32.exe'}
    add(ev.event_type == 'file' and 'creat' in action and process in downloaders
        and bool(re.search(r'\.(exe|dll|ps1|bat|cmd|vbs|js|hta|scr|zip|7z|rar)$', (ev.file_path or '').lower())), 'T1105')
    add(('schtasks' in text and '/create' in text) or ev.event_type == 'scheduled_task' or action == '4698', 'T1053.005')
    add(bool(re.search(r'\bsc(?:\.exe)?\s+create\b', text)) or 'new-service' in text or ev.event_type == 'service' or action in ('7045', '4697'), 'T1543.003')
    # JSON escapa as barras; consulte também os valores decodificados.
    registry = str(ev.extra.get('registry_key') or '').lower()
    add(any(term in command + registry for term in ('\\currentversion\\run', '\\runonce')), 'T1547.001')
    add(('comsvcs.dll' in text and 'minidump' in text) or ('procdump' in text and 'lsass' in text) or str(ev.extra.get('target_process', '')).lower() == 'lsass.exe' or 'sekurlsa' in text or 'mimikatz' in text, 'T1003.001')
    add('reg save' in text and any(term in command for term in ('hklm\\sam', 'hklm\\security')), 'T1003.002')
    add('ntdsutil' in text or 'ntds.dit' in text, 'T1003.003')
    add((ev.event_type == 'logon' and str(ev.extra.get('logon_type', '')).lower() in ('10', 'remoteinteractive')) or process == 'mstsc.exe' or (ev.event_type == 'network' and ev.dst_port == 3389), 'T1021.001')
    add(any(term in text for term in ('psexec', 'psexesvc', '\\admin$')), 'T1021.002', 'T1569.002')
    add(any(term in text for term in ('wsmprovhost', 'enter-pssession', 'winrs')), 'T1021.006')
    add(any(term in process + ' ' + command for term in ('rclone', 'megacmd', 'megasync')) or ('restic' in process + command and bool(re.search(r'(?:s3:|sftp:|rest:|rclone:|b2:|azure:|gs:|https?://)', command))), 'T1567.002')
    add(action in ('1102', '104') or 'wevtutil cl' in text or 'clear-eventlog' in text, 'T1070.001')
    add('vssadmin delete shadows' in text or 'wmic shadowcopy delete' in text or ('bcdedit' in text and 'recoveryenabled no' in text), 'T1490')
    add('whoami' in text, 'T1033')
    add('net group' in text or 'net localgroup' in text, 'T1069')
    add('nltest /domain_trusts' in text, 'T1482')
    add('net view' in text or 'adfind' in text, 'T1018')
    if ev.event_type == 'signin':
        add(str(ev.extra.get('error_code')) == '500121', 'T1621')
        add(ev.outcome == 'success' and str(ev.extra.get('risk_level', '')).lower() in ('medium', 'high'), 'T1078.004')
    if ev.event_type == 'audit':
        add(action in ('user registered security info', 'admin registered security info', 'user registered all required security info') or (action == 'update user' and 'strongauthentication' in extra), 'T1098.005')
        add(action == 'consent to application', 'T1528')
        add(action in ('add member to role', 'add eligible member to role'), 'T1098.003')
        add(action == 'add service principal credentials' or action.replace('–', '-') == 'update application - certificates and secrets management', 'T1098.001')
    add('new-inboxrule' in command + action or 'set-inboxrule' in command + action, 'T1564.008')
    add(ev.event_type == 'network' and is_external_ip(ev.dst_ip) and process in ('powershell.exe', 'pwsh.exe', 'rundll32.exe', 'regsvr32.exe', 'mshta.exe'), 'T1071.001')
    return sorted(found)


def annotate(ev: Event) -> Event:
    suggestions = suggest(ev)
    ev.mitre = sorted(set(ev.mitre) | set(suggestions))
    ev.extra['mitre_heuristica'] = suggestions
    return ev
