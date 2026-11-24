from pathlib import Path

import pytest

from perito.parsers.detect import detect_source

SAMPLES = Path(__file__).resolve().parents[1] / 'samples' / 'caso-sintetico'
FILES = {
    'defender_advanced_hunting.csv': ('defender', 18),
    'sentinel_securityevent.json': ('sentinel', 7),
    'entra_signin.json': ('entra_signin', 7),
    'entra_audit.json': ('entra_audit', 3),
    'splunk_export.csv': ('splunk', 7),
    'elastic_dns.ndjson': ('elastic', 4),
    'wazuh_alerts.json': ('wazuh', 4),
}


@pytest.mark.parametrize('name,expected', [(n, s) for n, (s, _) in FILES.items()])
def test_detect_samples(name, expected):
    assert detect_source(SAMPLES / name) == expected


def test_unknown():
    assert detect_source(SAMPLES / 'GABARITO.md') is None


@pytest.mark.parametrize('header,source', [('Timestamp,ActionType', 'defender'), ('TimeGenerated,Type', 'sentinel'), ('_time,sourcetype', 'splunk')])
def test_csv_header_only(tmp_path, header, source):
    path = tmp_path / 'empty.csv'
    path.write_text(header + '\n', encoding='utf-8-sig')
    assert detect_source(path) == source


def test_empty_search_export(tmp_path):
    path = tmp_path / 'search.json'
    path.write_text('{"hits":{"hits":[]}}', encoding='utf-8')
    assert detect_source(path) == 'elastic'
