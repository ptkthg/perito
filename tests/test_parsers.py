import json

import pytest

from perito.parsers import parse_file
from test_detect import FILES, SAMPLES


def events(source):
    name = next(n for n, (s, _) in FILES.items() if s == source)
    return list(parse_file(SAMPLES / name, source))


@pytest.mark.parametrize('name,source,count', [(n, s, c) for n, (s, c) in FILES.items()])
def test_counts_timestamps_and_refs(name, source, count):
    rows = list(parse_file(SAMPLES / name, source))
    assert len(rows) == count
    assert all(e.ts_utc.endswith('Z') and e.ts_original and e.raw_ref.startswith(name) for e in rows)
    assert [e.ts_utc for e in rows] == sorted(e.ts_utc for e in rows)


def test_defender():
    rows = events('defender')
    ps = next(e for e in rows if e.process == 'powershell.exe' and e.event_type == 'process')
    assert (ps.parent, ps.host, ps.user) == ('excel.exe', 'ws-fin-023', 'm.silva')
    assert '-enc' in ps.cmdline.lower()
    net = next(e for e in rows if e.dst_ip == '203.0.113.45')
    assert (net.dst_port, net.domain, net.extra['host_ip']) == (443, 'cdn-update.example-cdn.net', '10.10.20.23')
    assert next(e for e in rows if e.event_type == 'email').extra['attachment'] == 'Fatura_88213.xlsm'
    assert next(e for e in rows if e.action == 'OpenProcessApiCall').extra['target_process'] == 'lsass.exe'
    assert rows[0].raw_ref == 'defender_advanced_hunting.csv:2'


def test_windows_and_observers():
    rows = events('sentinel')
    rdp = next(e for e in rows if e.action == '4624' and e.user == 'svc_backup')
    assert (rdp.extra['logon_type'], rdp.src_ip, rdp.host) == (10, '10.10.20.23', 'srv-file-01')
    rc = next(e for e in rows if e.action == '4688' and e.process == 'rclone.exe')
    assert (rc.process, rc.parent) == ('rclone.exe', 'cmd.exe')
    assert next(e for e in rows if e.action == '1102').event_type == 'audit'
    rows = events('splunk')
    rc = next(e for e in rows if e.event_type == 'process')
    assert rc.ts_utc == '2026-11-10T13:57:40.120Z'
    assert rc.process == 'rclone.exe' and rc.sha256 == rc.sha256.lower()
    fw = rows[0]
    assert fw.host is None and fw.extra['observer'] == 'pa-fw-01'
    assert isinstance(fw.extra['bytes_out'], int)
    dns = events('elastic')[0]
    assert (dns.event_type, dns.host, dns.extra['observer']) == ('dns', None, 'dc01')
    assert dns.domain and dns.src_ip and dns.dst_ip


def test_entra_and_wazuh():
    rows = events('entra_signin')
    failures = [e for e in rows if e.extra['error_code'] == 500121]
    assert len(failures) == 3 and all(e.outcome == 'failure' for e in failures)
    assert any(e.outcome == 'success' and e.src_ip == '198.51.100.77' and e.extra['country'] == 'NL' and e.user == 'm.silva' for e in rows)
    rows = events('entra_audit')
    assert next(e for e in rows if e.action == 'User registered security info').src_ip == '198.51.100.77'
    assert 'MailSync Pro' in next(e for e in rows if e.action == 'Consent to application').extra['targets']
    rows = events('wazuh')
    assert rows[1].ts_utc == '2026-11-10T13:40:15.512Z'
    assert rows[1].event_type == 'logon' and rows[1].mitre == ['T1021.001']
    assert rows[2].event_type == 'process' and rows[2].severity == 'high'


@pytest.mark.parametrize('invalid_time', [False, True])
def test_corrupt_records_are_counted(tmp_path, caplog, invalid_time):
    path = tmp_path / 'broken.ndjson'
    good = {'Timestamp': '2026-01-01T00:00:00Z', 'ActionType': 'ProcessCreated'}
    text = json.dumps(good) + '\n{broken\n' + json.dumps(good) + '\n'
    if invalid_time:
        text += json.dumps({**good, 'Timestamp': 'bad'})
    path.write_text(text, encoding='utf-8')
    stats = {}
    rows = list(parse_file(path, 'defender', stats))
    assert len(rows) == 2 and stats['ignorados'] == 1 + invalid_time
    assert [e.raw_ref for e in rows] == ['broken.ndjson:1', 'broken.ndjson:3']
    assert 'perito.parsers' in caplog.text


@pytest.mark.parametrize('wrapper', ['array', 'value', 'hits', 'result'])
def test_json_containers(tmp_path, wrapper):
    rec = {'@timestamp': '2026-01-01T00:00:00Z', 'event.category': 'process', 'process.name': 'CMD.EXE'}
    data = {'array': [rec], 'value': {'value': [rec]}, 'hits': {'hits': {'hits': [{'_source': rec}]}}, 'result': {'result': rec}}[wrapper]
    path = tmp_path / 'export.json'
    path.write_text(json.dumps(data), encoding='utf-8')
    row, = parse_file(path, 'elastic')
    assert row.process == 'cmd.exe'
    assert row.raw_ref == ('export.json:1' if wrapper == 'result' else 'export.json#0')


def test_csv_physical_lines(tmp_path):
    path = tmp_path / 'multiline.csv'
    path.write_text('Timestamp,ActionType,ProcessCommandLine\n2026-01-01T00:00:00Z,ProcessCreated,"a\nb"\n2026-01-01T00:00:01Z,ProcessCreated,c\n', encoding='utf-8-sig')
    assert [e.raw_ref for e in parse_file(path, 'defender')] == ['multiline.csv:2', 'multiline.csv:4']


def test_wazuh_network_without_process_is_observer(tmp_path):
    rec = {'timestamp': '2026-01-01T00:00:00Z', 'agent': {'name': 'DNS01', 'ip': '10.0.0.1'}, 'rule': {'level': 4}, 'data': {'win': {'system': {'eventID': '22', 'providerName': 'Sysmon'}, 'eventdata': {'QueryName': 'example.net', 'QueryResults': '203.0.113.45'}}}}
    path = tmp_path / 'dns.json'
    path.write_text(json.dumps([rec]), encoding='utf-8')
    row, = parse_file(path, 'wazuh')
    assert row.host is None and row.extra['observer'] == 'dns01'


def test_sentinel_connectors_and_aliases(tmp_path):
    recs = [
        {'Type': 'SigninLogs', 'TimeGenerated': '2026-01-01T00:00:00Z', 'UserPrincipalName': 'TEST@example.net', 'ResultType': '0', 'LocationDetails': '{"city":"Recife","countryOrRegion":"BR"}', 'DeviceDetail': '{"displayName":"WS01"}'},
        {'Type': 'AuditLogs', 'TimeGenerated': '2026-01-01T00:00:01Z', 'OperationName': 'Consent to application', 'Result': 'success', 'InitiatedBy': '{"app":{"displayName":"Automação"}}', 'TargetResources': '[{"displayName":"Aplicativo"}]'},
        {'Type': 'DeviceProcessEvents', 'TimeGenerated': '2026-01-01T00:00:02Z', 'FileName': 'CMD.EXE'},
        {'Type': 'CommonSecurityLog', 'TimeGenerated': '2026-01-01T00:00:03Z', 'DeviceName': 'FW01', 'DeviceAction': 'allow', 'SentBytes': '42'},
        {'Type': 'SecurityAlert', 'TimeGenerated': '2026-01-01T00:00:04Z', 'AlertName': 'Teste', 'Techniques': '["T1003.001"]', 'AlertSeverity': 'HIGH'},
    ]
    path = tmp_path / 'connectors.json'
    path.write_text(json.dumps(recs), encoding='utf-8')
    signin, audit, process, network, alert = parse_file(path, 'sentinel')
    assert signin.user == 'test' and signin.extra['country'] == 'BR' and signin.outcome == 'success'
    assert audit.user is None and audit.extra['initiated_by_app'] == 'Automação'
    assert process.source == 'sentinel' and process.process == 'cmd.exe'
    assert network.host is None and network.extra['observer'] == 'fw01' and network.extra['bytes_out'] == 42
    assert alert.mitre == ['T1003.001'] and alert.severity == 'high'


def test_csv_blank_lines_keep_physical_references(tmp_path):
    path = tmp_path / 'blank.csv'
    path.write_text('Timestamp,ActionType\n\n2026-01-01T00:00:00Z,ProcessCreated\n\n2026-01-01T00:00:01Z,ProcessCreated\n', encoding='utf-8')
    assert [e.raw_ref for e in parse_file(path, 'defender')] == ['blank.csv:3', 'blank.csv:5']


def test_nonobject_json_is_counted(tmp_path):
    path = tmp_path / 'scalar.json'
    path.write_text('42', encoding='utf-8')
    stats = {}
    assert list(parse_file(path, 'defender', stats)) == []
    assert stats['ignorados'] == 1
