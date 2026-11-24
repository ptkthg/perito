import pytest

from perito.mitre import TECHNIQUES, annotate, suggest
from perito.schema import Event


def ev(**kwargs):
    return Event(ts_utc='2026-01-01T00:00:00.000Z', source='defender', raw_ref='test:1', event_type=kwargs.pop('event_type', 'process'), **kwargs)


@pytest.mark.parametrize('fields,expected', [
    ({'event_type': 'email', 'extra': {'attachment': 'x.XLSM'}}, ['T1566.001']),
    ({'event_type': 'email', 'extra': {'url': 'https://example.net'}}, ['T1566.002']),
    ({'process': 'powershell.exe', 'parent': 'excel.exe', 'cmdline': 'PowerShell -EncodedCommand abc'}, ['T1059.001', 'T1027', 'T1204.002']),
    ({'process': 'cmd.exe', 'cmdline': 'cmd /c whoami'}, ['T1059.003', 'T1033']),
    ({'process': 'wscript.exe'}, ['T1059.005']),
    ({'process': 'mshta.exe'}, ['T1218.005']),
    ({'process': 'regsvr32.exe'}, ['T1218.010']),
    ({'process': 'rundll32.exe', 'cmdline': r'rundll32.exe C:\Users\Public\x.dll,Start'}, ['T1218.011']),
    # rundll32 como INICIADOR (acesso ao LSASS) não é T1218.011
    ({'event_type': 'other', 'process': 'rundll32.exe', 'extra': {'target_process': 'lsass.exe'}}, ['T1003.001']),
    # efeitos colaterais de powershell (arquivo/rede) não recebem T1059.001
    ({'event_type': 'file', 'process': 'powershell.exe', 'action': 'FileCreated', 'file_path': r'C:\Users\a\AppData\Roaming\x.exe'}, ['T1105']),
    ({'event_type': 'file', 'process': 'rundll32.exe', 'action': 'FileCreated', 'file_path': r'C:\Users\Public\d.bin'}, []),
    ({'cmdline': 'certutil.exe -urlcache -f https://example.net/a'}, ['T1105']),
    ({'cmdline': 'bitsadmin /transfer a https://example.net'}, ['T1105']),
    ({'event_type': 'scheduled_task'}, ['T1053.005']),
    ({'cmdline': 'schtasks /create /tn x'}, ['T1053.005']),
    ({'cmdline': 'sc.exe create x'}, ['T1543.003']),
    ({'event_type': 'registry', 'extra': {'registry_key': r'HKCU\Software\Microsoft\Windows\CurrentVersion\Run'}}, ['T1547.001']),
    ({'process': 'rundll32.exe', 'cmdline': 'comsvcs.dll MiniDump 123'}, ['T1003.001']),
    ({'extra': {'target_process': 'LSASS.EXE'}}, ['T1003.001']),
    ({'cmdline': r'reg save HKLM\SAM x'}, ['T1003.002']),
    ({'cmdline': 'ntdsutil'}, ['T1003.003']),
    ({'event_type': 'logon', 'extra': {'logon_type': 'RemoteInteractive'}}, ['T1021.001']),
    ({'process': 'psexec.exe'}, ['T1021.002', 'T1569.002']),
    ({'cmdline': 'Enter-PSSession server'}, ['T1021.006']),
    ({'process': 'rclone.exe'}, ['T1567.002']),
    ({'cmdline': 'restic backup data -r s3:https://backup/x'}, ['T1567.002']),
    ({'event_type': 'audit', 'action': '1102'}, ['T1070.001']),
    ({'cmdline': 'vssadmin delete shadows /all'}, ['T1490']),
    ({'cmdline': 'net localgroup administrators'}, ['T1069']),
    ({'cmdline': 'nltest /domain_trusts'}, ['T1482']),
    ({'cmdline': 'net view'}, ['T1018']),
    ({'event_type': 'signin', 'extra': {'error_code': 500121}}, ['T1621']),
    ({'event_type': 'signin', 'outcome': 'success', 'extra': {'risk_level': 'HIGH'}}, ['T1078.004']),
    ({'event_type': 'audit', 'action': 'Update user', 'extra': {'details': {'field': 'StrongAuthenticationMethods'}}}, ['T1098.005']),
    ({'event_type': 'audit', 'action': 'Consent to application'}, ['T1528']),
    ({'event_type': 'audit', 'action': 'Add eligible member to role'}, ['T1098.003']),
    ({'event_type': 'audit', 'action': 'Add service principal credentials'}, ['T1098.001']),
    ({'cmdline': 'New-InboxRule -Name x'}, ['T1564.008']),
    ({'event_type': 'network', 'process': 'powershell.exe', 'dst_ip': '203.0.113.45'}, ['T1071.001']),
])
def test_rules(fields, expected):
    actual = suggest(ev(**fields))
    assert actual == sorted(expected)
    assert set(actual) <= TECHNIQUES.keys()


def test_no_false_rules_and_preserve_source():
    for fields in ({'process': 'ms-teams.exe'}, {'process': 'msedge.exe', 'domain': 'www.office.com'}, {'event_type': 'logon', 'user': 'dc01$'}, {'cmdline': 'restic backup -r C:\\backup'}, {'event_type': 'audit', 'action': 'Update user'}):
        assert suggest(ev(**fields)) == []
    row = ev(process='powershell.exe', mitre=['T9999', 'T1059.001'])
    assert annotate(row) is row
    assert row.mitre == ['T1059.001', 'T9999']
    assert row.extra['mitre_heuristica'] == ['T1059.001']
