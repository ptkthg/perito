import csv
import json
import os
import stat

import pytest

from perito.cli import main
from test_detect import SAMPLES


@pytest.fixture
def case_cli(tmp_path, capsys):
    def run(*args):
        code = main(['--casos', str(tmp_path), *args])
        captured = capsys.readouterr()
        return code, captured.out, captured.err
    assert run('novo-caso', 'TESTE-001', '--titulo', 'Caso sintético')[0] == 0
    return tmp_path / 'TESTE-001', run


def test_full_workflow(case_cli):
    path, run = case_cli
    assert (path / 'caso.md').is_file() and (path / 'relatorios').is_dir()
    assert run('ingerir', 'TESTE-001', str(SAMPLES))[0] == 0
    normalized = sorted((path / 'normalizado').glob('*.jsonl'))
    assert len(normalized) == 7
    assert sum(len(p.read_text(encoding='utf-8').splitlines()) for p in normalized) == 50
    assert (path / 'timeline' / 'timeline.csv').is_file()
    assert len(list(csv.DictReader((path / 'custodia.csv').open(encoding='utf-8', newline='')))) == 7
    assert run('ingerir', 'TESTE-001', str(SAMPLES))[0] == 0
    assert len(list(csv.DictReader((path / 'custodia.csv').open(encoding='utf-8', newline='')))) == 7
    assert sum(len(p.read_text(encoding='utf-8').splitlines()) for p in normalized) == 50
    code, out, err = run('timeline', 'TESTE-001', '--host', 'ws-fin-023', '--formato', 'jsonl')
    assert code == 0 and not err
    rows = [json.loads(line) for line in out.splitlines()]
    assert rows and all('ws-fin-023' in (e['host'], e['extra'].get('src_host'), e['extra'].get('dst_host'), e['extra'].get('observer')) for e in rows)
    code, out, _ = run('pivo', 'TESTE-001', '--ip', '198.51.100.77')
    assert code == 0 and 'm.silva' in out and 'MailSync Pro' in out and 'Entidades relacionadas' in out
    code, out, _ = run('resumo', 'TESTE-001')
    assert code == 0 and 'T1003.001' in out and 'Acesso a credenciais' in out and '[LIMITAÇÃO]' in out
    for _ in range(2):
        assert run('iocs', 'TESTE-001', '--gravar')[0] == 0
    with (path / 'iocs.csv').open(encoding='utf-8', newline='') as fh:
        iocs = list(csv.DictReader(fh))
    assert iocs and len(iocs) == len({(r['tipo'], r['valor']) for r in iocs})
    code, out, _ = run('casos')
    assert code == 0 and 'TESTE-001' in out and 'Caso sintético' in out and '50' in out
    assert run('verificar', 'TESTE-001')[0] == 0


def test_readonly_and_integrity(case_cli):
    path, run = case_cli
    assert run('ingerir', 'TESTE-001', str(SAMPLES))[0] == 0
    raw_files = list((path / 'evidencias' / 'brutas').iterdir())
    assert len(raw_files) == 7 and all(not os.access(p, os.W_OK) for p in raw_files)
    raw = raw_files[0]
    raw.chmod(raw.stat().st_mode | stat.S_IWRITE)
    content = raw.read_bytes()
    raw.write_bytes(bytes([content[0] ^ 1]) + content[1:])
    code, out, _ = run('verificar', 'TESTE-001')
    assert code == 2 and 'hash divergente' in out


def test_output_limit_and_filters(case_cli, tmp_path):
    path, run = case_cli
    assert run('ingerir', 'TESTE-001', str(SAMPLES))[0] == 0
    destination = tmp_path / 'export.csv'
    code, _, _ = run('timeline', 'TESTE-001', '--tipo', 'process', '--formato', 'csv', '--limite', '2', '--saida', str(destination))
    assert code == 0
    with destination.open(encoding='utf-8', newline='') as fh:
        exported = list(csv.DictReader(fh))
    assert len(exported) == 2 and all(e['event_type'] == 'process' for e in exported)
    assert len((path / 'timeline' / 'timeline.jsonl').read_text(encoding='utf-8').splitlines()) == 50
    code, out, err = run('timeline', 'TESTE-001', '--dominio', 'EXAMPLE-CDN', '--formato', 'jsonl')
    rows = [json.loads(line) for line in out.splitlines()]
    assert code == 0 and not err and rows
    assert all('example-cdn' in row['domain'].lower() for row in rows)


def test_unknown_evidence_and_errors(case_cli, tmp_path):
    path, run = case_cli
    unknown = tmp_path / 'unknown.log'
    unknown.write_text('{"unknown": 1}', encoding='utf-8')
    code, _, err = run('ingerir', 'TESTE-001', str(unknown))
    assert code == 0 and 'fonte' in err.lower()
    assert (path / 'evidencias' / 'brutas' / unknown.name).is_file()
    binary = tmp_path / 'memory.bin'
    binary.write_bytes(b'\x00\x01')
    assert run('evidencia', 'TESTE-001', str(binary), '--obs', 'Memória')[0] == 0
    for args in [('novo-caso', 'TESTE-001'), ('resumo', 'INEXISTENTE'), ('ingerir', 'TESTE-001', str(tmp_path / 'missing')), ('timeline', 'TESTE-001', '--de', 'bad'), ('pivo', 'TESTE-001'), ('nao-existe',), ('timeline', 'TESTE-001', '--limite', '-1')]:
        code, _, err = run(*args)
        assert code == 1 and err and 'Traceback' not in err


def test_ingest_counts_skipped(case_cli, tmp_path):
    path, run = case_cli
    source = tmp_path / 'broken.ndjson'
    source.write_text('{"Timestamp":"2026-01-01T00:00:00Z","ActionType":"ProcessCreated"}\nBAD\n', encoding='utf-8')
    code, out, _ = run('ingerir', 'TESTE-001', str(source))
    assert code == 0 and '| 1 | 1 |' in out
    rows = (path / 'normalizado' / 'defender__broken.jsonl').read_text(encoding='utf-8').splitlines()
    assert len(rows) == 1


def test_output_cannot_overwrite_raw_evidence(case_cli):
    path, run = case_cli
    assert run('ingerir', 'TESTE-001', str(SAMPLES))[0] == 0
    raw = next((path / 'evidencias' / 'brutas').iterdir())
    original = raw.read_bytes()
    code, _, err = run('timeline', 'TESTE-001', '--saida', str(raw))
    assert code == 1 and 'imutável' in err and raw.read_bytes() == original


def test_debug_and_help(case_cli):
    _, run = case_cli
    assert run('--help')[0] == 0
    code, _, err = run('--debug', 'resumo', 'NAO-EXISTE')
    assert code == 1 and 'Traceback' in err
