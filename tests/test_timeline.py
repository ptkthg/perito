import csv
import json

import pytest

from perito import timeline
from perito.case import create_case
from perito.mitre import annotate
from perito.schema import Event
from test_detect import FILES, SAMPLES
from perito.parsers import parse_file


@pytest.fixture
def rows():
    return timeline.build([annotate(e) for name, (source, _) in FILES.items() for e in parse_file(SAMPLES / name, source)])


def test_synthetic_timeline(rows):
    assert len(rows) == 50
    # A amostra Audit contém Update user às 10:00Z: preservamos a evidência.
    assert rows[0].ts_utc == '2026-11-10T10:00:00.000Z'
    assert next(e for e in rows if e.event_type == 'email').ts_utc == '2026-11-10T13:02:11.341Z'
    assert {'T1566.001', 'T1204.002', 'T1059.001', 'T1027', 'T1105', 'T1053.005', 'T1003.001', 'T1621', 'T1078.004', 'T1098.005', 'T1528', 'T1021.001', 'T1567.002', 'T1070.001', 'T1071.001'} <= {t for e in rows for t in e.mitre}
    assert timeline.ip_host_map(rows) == {'10.10.20.23': 'ws-fin-023', '10.10.30.5': 'srv-file-01'}
    # Sign-in de j.souza também informa ws-fin-041, sem evento de EDR.
    assert timeline.coverage(rows)['hosts_sem_edr'] == ['srv-file-01', 'ws-fin-041']
    for row in rows:
        if row.process in ('ms-teams.exe', 'msedge.exe') or row.user == 'dc01$':
            assert row.mitre == []


def test_corroboration_and_volume(rows):
    rc = [e for e in rows if e.event_type == 'process' and e.process == 'rclone.exe']
    assert len(rc) == 3
    for row in rc:
        assert set(row.extra['corroborado_por']) == {e.raw_ref for e in rc if e is not row}
    rdp = [e for e in rows if e.event_type == 'logon' and e.user == 'svc_backup' and e.host == 'srv-file-01' and str(e.extra.get('logon_type')) == '10']
    assert len(rdp) == 2 and all('corroborado_por' not in e.extra for e in rdp)
    assert next(e for e in rows if e.extra.get('bytes_out') == 1288490188).extra['volume_alto'] is True
    assert 'volume_alto' not in next(e for e in rows if e.extra.get('bytes_out') == 4521).extra


def test_filters_entities_iocs(rows):
    selected_domains = timeline.filter_events(rows, domain='EXAMPLE-CDN')
    assert selected_domains
    assert all('example-cdn' in e.domain.lower() for e in selected_domains)
    selected = timeline.filter_events(rows, host='SRV-FILE-01.acme.local')
    assert any(e.source == 'splunk' and e.extra.get('observer') == 'pa-fw-01' for e in selected)
    assert timeline.filter_events(rows, user='ACME\\M.Silva')
    assert timeline.filter_events(rows, host='dc01')  # observer
    assert all(e.source in ('sentinel', 'wazuh') and e.event_type == 'logon' for e in timeline.filter_events(rows, fonte='sentinel,wazuh', tipo='logon'))
    assert timeline.filter_events(rows, texto='MAILSYNC PRO')
    assert len(timeline.filter_events(rows, de=rows[0].ts_utc, ate=rows[0].ts_utc)) == 1
    iocs = timeline.ioc_candidates(rows)
    values = {r['valor'] for r in iocs}
    assert {'203.0.113.45', '198.51.100.200', '198.51.100.77', 'cdn-update.example-cdn.net', 'bkp.example-storage.net', '45ed71c9d81d104a33a15541d8ad8188bc2fad4c87982a05e6275462355f2622'} <= values
    assert 'www.office.com' not in values and '10.10.20.23' not in values
    assert len({(r['tipo'], r['valor']) for r in iocs}) == len(iocs)
    assert not any(r['valor'] == 'e3358b51efbc884f392046e1bd69ba6495e4555edc53e70d1e9b9d1e3cf5b281' for r in iocs)
    entities = timeline.entities(rows)
    assert entities['host']['srv-file-01']['eventos'] > 0
    assert entities['user']['m.silva']['fontes'] == sorted(entities['user']['m.silva']['fontes'])


def test_dedupe_and_outputs(rows, tmp_path):
    built = timeline.build(rows + [rows[0]])
    assert len(built) == len(rows) and built[0].extra['duplicatas'] == 1
    assert 'duplicatas' not in rows[0].extra  # build não contamina entrada
    case = create_case('TEST-02', base=tmp_path)
    files = timeline.write_outputs(case, built)
    assert len(files) == 3 and all(p.is_file() for p in files.values())
    with (case.timeline_dir / 'timeline.csv').open(encoding='utf-8', newline='') as fh:
        reader = csv.DictReader(fh)
        assert reader.fieldnames == 'ts_utc,source,event_type,host,user,src_ip,dst_ip,dst_port,domain,process,parent,cmdline,file_path,sha256,action,outcome,severity,mitre,description,raw_ref,ts_original,src_host,dst_host,corroborado_por'.split(',')
        assert len(list(reader)) == 50
    assert len([json.loads(line) for line in (case.timeline_dir / 'timeline.jsonl').read_text(encoding='utf-8').splitlines()]) == 50
    assert '⧉' in timeline.render_md(rows) and '⚠ volume' in timeline.render_md(rows)
    assert timeline.coverage([])['janela'] == {'primeiro': None, 'ultimo': None}


def test_corroboration_requires_entity_and_window():
    def row(source, timestamp, **kwargs):
        return Event(timestamp, source, 'process', source + ':1', **kwargs)
    empty = [row('defender', '2026-01-01T00:00:00.000Z'), row('sentinel', '2026-01-01T00:00:00.001Z')]
    assert all('corroborado_por' not in e.extra for e in timeline.build(empty))
    pair = [row('defender', '2026-01-01T00:00:00.000Z', host='a', process='x.exe'), row('sentinel', '2026-01-01T00:00:02.000Z', host='a', process='x.exe')]
    assert all(e.extra['corroborado_por'] for e in timeline.build(pair))
