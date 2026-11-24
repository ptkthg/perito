"""Contrato de escrita HTTP com servidor real e casos isolados."""
import json
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from pathlib import Path
from threading import Thread
from urllib.parse import quote

import pytest

from perito import case as cases
from perito.cli import main
from perito.ui.server import create_server

SAMPLES = Path(__file__).resolve().parents[1] / 'samples' / 'caso-sintetico'
ROOT = '/api/casos/TESTE-001/'


@pytest.fixture
def workbench(tmp_path):
    case = cases.create_case('TESTE-001', base=tmp_path)
    server = create_server(tmp_path, port=0, token='segredo')
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def request(method, route, data=None, *, headers=None, token=True, raw=None, length=True):
        body = raw if raw is not None else json.dumps(data).encode() if data is not None else b''
        fields = {'Content-Type': 'application/json'}
        if token:
            fields['X-Perito-Token'] = 'segredo'
        if length:
            fields['Content-Length'] = str(len(body))
        fields.update(headers or {})
        conn = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
        conn.putrequest(method, route if route.startswith('/api') else ROOT + route)
        for key, value in fields.items():
            conn.putheader(key, value)
        conn.endheaders(body)
        response = conn.getresponse()
        result = response.status, json.loads(response.read()), dict(response.getheaders())
        conn.close()
        return result

    yield case, request
    server.shutdown()
    server.server_close()
    thread.join()


def version(request, route):
    status, _, headers = request('GET', route)
    assert status == 200
    return headers['X-Perito-Versao']


def seed(case):
    assert main(['--casos', str(case.path.parent), 'ingerir', case.case_id, str(SAMPLES)]) == 0
    (case.path / 'achados.md').write_text(cases.SKELETON['achados.md'] + ''.join(
        f'| A{i} | UTC | host | user | Achado | T1059 | edr.csv:{i} |\n' for i in range(1, 15)), encoding='utf-8')
    (case.path / 'hipoteses.md').write_bytes(('Prévia\r\n## H1: Inicial\r\n- **Status:** aberta\r\n'
        '## H2: Execução\r\n- **Status:** confirmada\r\n- **Confiança:** alta\r\n'
        '- **Sustentação ([EVIDÊNCIA] com raw_ref):** A6\r\n- **Próximo passo:** investigar\r\n'
        '\r\n## H3: Final\r\nTexto intacto.\r\n').encode())
    (case.path / 'limitacoes.md').write_text(cases.SKELETON['limitacoes.md'] + ''.join(
        f'| {i} | Lacuna | Impacto | Mitigar |\n' for i in range(1, 4)), encoding='utf-8')


def test_ingestion_stream_custody_and_cleanup(workbench, monkeypatch):
    case, req = workbench
    original_add = cases.add_evidence
    calls = []
    def tracked_add(target, path, **kwargs):
        assert path.parent == case.path / '.uploads'
        calls.append(path)
        return original_add(target, path, **kwargs)
    monkeypatch.setattr(cases, 'add_evidence', tracked_add)
    payload = (SAMPLES / 'wazuh_alerts.json').read_bytes()
    headers = {'Content-Type': 'application/octet-stream', 'X-Perito-Arquivo': quote('wazuh_alerts.json')}
    for _ in range(2):
        status, result, _ = req('POST', 'ingestao', raw=payload, headers=headers)
        assert status == 200 and result['ok'] and result['detectado']
        assert result['eventos'] == 4 and result['fonte'] == 'wazuh' and len(result['sha256']) == 64
    assert len(cases.read_custody(case)) == 1 and cases.verify_custody(case) == []
    assert req('GET', 'eventos')[1]['total'] == 4
    assert req('POST', 'ingestao', raw=payload, headers={**headers, 'X-Perito-Arquivo': '../../x.json'})[0] == 400
    assert req('POST', 'ingestao', headers=headers, length=False)[0] == 411
    status, result, _ = req('POST', 'ingestao', raw=b'qualquer texto', headers={**headers, 'X-Perito-Arquivo': 'nota.txt'})
    assert status == 200 and result['detectado'] is False and 'sem parser' in result['mensagem']
    assert len(cases.read_custody(case)) == 2
    assert not list((case.path / '.uploads').iterdir())
    assert len(calls) == 3
    assert len((case.path / 'auditoria-ui.log').read_text(encoding='utf-8').splitlines()) == 3


def test_findings_versions_and_audit(workbench):
    case, req = workbench
    seed(case)
    events = req('GET', 'eventos')[1]['eventos']
    ev = next(e for e in events if e.get('process') == 'powershell.exe')
    old = version(req, 'achados')
    doc = req('GET', 'doc/achados')[1]
    assert doc['versao'] == old
    body = dict(idx=ev['idx'], achado='Execução | suspeita\nobservada', attack=['T1059.001'], versao=old)
    status, result, _ = req('POST', 'achados', body)
    assert status == 200 and result['id'] == 'A15' and result['versao'] != old
    findings = req('GET', 'achados')[1]
    assert len(findings) == 15 and ev['raw_ref'] in findings[-1]['evidencia']
    before = (case.path / 'achados.md').read_bytes()
    status, conflict, _ = req('POST', 'achados', body)
    assert status == 409 and conflict['erro'] == 'conflito' and conflict['versao_atual'] == result['versao']
    assert conflict['conteudo_atual'] == before.decode()
    assert (case.path / 'achados.md').read_bytes() == before
    audit = [json.loads(line) for line in (case.path / 'auditoria-ui.log').read_text(encoding='utf-8').splitlines()]
    assert len(audit) == 1 and audit[0]['versao_antes'] == old
    assert audit[0]['versao_depois'] == result['versao'] and audit[0]['ts'].endswith('Z')


def test_hypotheses_preserve_bytes_and_refs(workbench):
    case, req = workbench
    seed(case)
    path = case.path / 'hipoteses.md'
    before = path.read_bytes()
    status, _, _ = req('PATCH', 'hipoteses/H2', dict(status='aberta', confianca='media', versao=version(req, 'hipoteses')))
    assert status == 200
    assert path.read_bytes() == before.replace(b'**Status:** confirmada', b'**Status:** aberta').replace(
        '**Confiança:** alta'.encode(), '**Confiança:** média'.encode())
    refs = [dict(ref='edr.csv:17', relacao='apoia'), dict(ref='A7', relacao='contradiz')]
    for _ in range(2):
        assert req('PATCH', 'hipoteses/H2', dict(refs_add=refs, versao=version(req, 'hipoteses')))[0] == 200
    h2 = next(h for h in req('GET', 'hipoteses')[1] if h['id'] == 'H2')
    assert h2['sustentacao'].count('edr.csv:17') == 1 and h2['contradiz'].count('A7') == 1
    assert req('PATCH', 'hipoteses/H2', dict(status='confirmada', versao=version(req, 'hipoteses')))[0] == 400
    assert req('PATCH', 'hipoteses/H2', dict(status='confirmada', justificativa='Conferido', versao=version(req, 'hipoteses')))[0] == 200
    h2 = next(h for h in req('GET', 'hipoteses')[1] if h['id'] == 'H2')
    assert 'Conferido' in h2['justificativa'] and 'Z' in h2['justificativa']
    status, body, _ = req('POST', 'hipoteses', dict(titulo='Nova hipótese', confianca='baixa', versao=version(req, 'hipoteses')))
    assert status == 200 and body['id'] == 'H4'
    assert req('PATCH', 'hipoteses/H2', dict(status='xyz', versao=version(req, 'hipoteses')))[0] == 400
    assert req('PATCH', 'hipoteses/H99', dict(status='aberta', versao=version(req, 'hipoteses')))[0] == 404


def test_placeholder_and_confirmation_requires_support(workbench):
    _, req = workbench
    assert req('POST', 'hipoteses', dict(titulo='Primeira', confianca='media', versao=version(req, 'hipoteses')))[1]['id'] == 'H1'
    assert req('PATCH', 'hipoteses/H1', dict(status='confirmada', justificativa='Teste', versao=version(req, 'hipoteses')))[0] == 400
    assert req('PATCH', 'hipoteses/H1', dict(status='confirmada', justificativa='Teste', refs_add=[dict(ref='A1', relacao='apoia')], versao=version(req, 'hipoteses')))[0] == 200


def test_iocs_atomic_batch_and_limitations(workbench):
    case, req = workbench
    seed(case)
    item = dict(tipo='ip', valor='203.0.113.9', contexto='Teste')
    assert req('POST', 'iocs', dict(**item, versao=version(req, 'iocs')))[0] == 200
    assert req('POST', 'iocs', dict(**item, versao=version(req, 'iocs')))[1]['existente'] is True
    assert req('PATCH', 'iocs', dict(tipo='ip', valor=item['valor'], confianca='confirmado', versao=version(req, 'iocs')))[0] == 200
    assert req('GET', 'iocs')[1]['registrados'][0]['confianca'] == 'confirmado'
    before = case.iocs_file.read_bytes()
    batch = [dict(tipo='ip', valor=item['valor'], confianca='descartado', motivo='interno'),
             dict(tipo='ip', valor='ausente', confianca='confirmado')]
    assert req('PATCH', 'iocs', dict(itens=batch, versao=version(req, 'iocs')))[0] == 404
    assert case.iocs_file.read_bytes() == before
    assert req('PATCH', 'iocs', dict(itens=batch[:1], versao=version(req, 'iocs')))[0] == 200
    assert req('GET', 'iocs')[1]['registrados'][0]['contexto'].endswith(' · descartado: interno')
    status, data, _ = req('POST', 'limitacoes', dict(limitacao='Sem EDR', impacto='Visibilidade parcial', mitigacao='Coletar logs', versao=version(req, 'doc/limitacoes')))
    assert status == 200 and data['id'] == 'L4'


@pytest.mark.parametrize('method,route,kwargs,expected', [
    ('POST', 'achados', dict(token=False), 403),
    ('POST', 'achados', dict(headers={'Host': 'evil.test'}), 403),
    ('POST', 'achados', dict(headers={'Content-Type': 'text/plain'}), 415),
    ('POST', 'achados', dict(raw=b' ' * (2 * 1024**2)), 413),
    ('PATCH', '/api/casos', {}, 405),
    ('POST', 'doc/caso', {}, 405),
    ('PUT', 'achados', {}, 405),
    ('POST', 'achados', dict(raw=b'{'), 400),
    ('POST', 'achados', dict(raw=b'[]'), 400),
    ('POST', 'ingestao', dict(headers={'Content-Type': 'application/octet-stream', 'X-Perito-Arquivo': 'ok.json', 'Content-Length': str(501 * 1024**2)}), 413),
])
def test_write_security(workbench, method, route, kwargs, expected):
    case, req = workbench
    status, _, headers = req(method, route, **kwargs)
    assert status == expected
    assert headers['X-Content-Type-Options'] == 'nosniff' and 'Content-Security-Policy' in headers
    assert not (case.path / 'auditoria-ui.log').exists()


def test_missing_file_versions_and_concurrent_conflict(workbench):
    case, req = workbench
    (case.path / 'achados.md').unlink()
    assert version(req, 'achados') == '0-0'
    old = version(req, 'hipoteses')
    def post(i):
        return req('POST', 'hipoteses', dict(titulo=f'Concorrente {i}', confianca='baixa', versao=old))[0]
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(post, range(2))) == [200, 409]


def test_formats(workbench):
    _, req = workbench
    status, rows, _ = req('GET', '/api/formatos')
    assert status == 200
    assert {r['fonte'] for r in rows} == {'auto', 'defender', 'sentinel', 'entra_signin', 'entra_audit', 'splunk', 'elastic', 'wazuh'}


@pytest.mark.parametrize('route,body', [
    ('achados', dict(idx=-1, achado='Teste', attack=[])),
    ('achados', dict(idx=True, achado='Teste', attack=[])),
    ('achados', dict(idx=0, achado='ab', attack=[])),
    ('achados', dict(idx=0, achado='Teste', attack=['T1059.01'])),
    ('hipoteses', dict(titulo='Teste', confianca='incerta')),
    ('iocs', dict(tipo='host', valor='host-01')),
    ('iocs', dict(tipo='ip', valor='')),
    ('limitacoes', dict(limitacao='ab', impacto='Teste', mitigacao='Teste')),
])
def test_invalid_data_never_writes(workbench, route, body):
    case, req = workbench
    before = {p: p.read_bytes() for p in case.path.rglob('*') if p.is_file()}
    body['versao'] = version(req, 'doc/limitacoes' if route == 'limitacoes' else route)
    assert req('POST', route, body)[0] == 400
    assert {p: p.read_bytes() for p in case.path.rglob('*') if p.is_file()} == before


def test_upload_parser_failure_cleanup(workbench, monkeypatch):
    from perito import cli
    case, req = workbench
    def broken(*args):
        raise ValueError('Falha sintética do parser')
    monkeypatch.setattr(cli, 'parse_file', broken)
    status, _, _ = req('POST', 'ingestao', raw=(SAMPLES / 'wazuh_alerts.json').read_bytes(), headers={
        'Content-Type': 'application/octet-stream', 'X-Perito-Arquivo': 'wazuh.json', 'X-Perito-Fonte': 'wazuh'})
    assert status == 400
    assert not list((case.path / '.uploads').iterdir())
    assert not list(case.normalized_dir.iterdir())
    assert len(cases.read_custody(case)) == 1 and not cases.verify_custody(case)


def test_missing_bullets_and_spaced_raw_refs_preserve_other_sections(workbench):
    case, req = workbench
    path = case.path / 'hipoteses.md'
    before = b'\xef\xbb\xbf# Hipoteses\r\n## H2: Teste\r\n\r\n## Outra secao\r\nIntacta\r\n'
    path.write_bytes(before)
    body = dict(status='aberta', confianca='baixa', proximo_passo='Coletar',
                refs_add=[dict(ref='my events.json:2', relacao='apoia')])
    for _ in range(2):
        assert req('PATCH', 'hipoteses/H2', dict(**body, versao=version(req, 'hipoteses')))[0] == 200
    after = path.read_bytes()
    assert after.startswith(b'\xef\xbb\xbf# Hipoteses\r\n')
    assert after.endswith(b'## Outra secao\r\nIntacta\r\n')
    assert after.count(b'my events.json:2') == 1


def test_placeholder_patch_is_missing(workbench):
    _, req = workbench
    assert req('PATCH', 'hipoteses/H1', dict(status='aberta', versao=version(req, 'hipoteses')))[0] == 404


def test_multiline_support_is_not_duplicated(workbench):
    case, req = workbench
    path = case.path / 'hipoteses.md'
    path.write_bytes(b'## H1: Teste\r\n- **Status:** aberta\r\n- **Sustenta\xc3\xa7\xc3\xa3o:** A1\r\n  edr.csv:2\r\n- **Refutaria:** Nada\r\n')
    assert req('PATCH', 'hipoteses/H1', dict(refs_add=[dict(ref='A2', relacao='apoia')], versao=version(req, 'hipoteses')))[0] == 200
    content = path.read_bytes()
    assert content.count(b'edr.csv:2') == 1
    assert content.endswith(b'- **Refutaria:** Nada\r\n')


def test_missing_tables_and_ioc_discard_validation(workbench):
    case, req = workbench
    seed(case)
    (case.path / 'achados.md').write_text('# Achados\n', encoding='utf-8')
    assert req('POST', 'achados', dict(idx=0, achado='Teste', attack=['T1059'], versao=version(req, 'achados')))[1]['id'] == 'A1'
    (case.path / 'limitacoes.md').write_text('# Limitações\n', encoding='utf-8')
    assert req('POST', 'limitacoes', dict(limitacao='Teste', impacto='Teste', mitigacao='Teste', versao=version(req, 'doc/limitacoes')))[1]['id'] == 'L1'
    assert req('POST', 'iocs', dict(tipo='dominio', valor='teste.invalid', versao=version(req, 'iocs')))[0] == 200
    for reason in ('', 'desconhecido', 'outro: ', 'outro: ' + 'a' * 201):
        before = case.iocs_file.read_bytes()
        assert req('PATCH', 'iocs', dict(tipo='dominio', valor='teste.invalid', confianca='descartado', motivo=reason, versao=version(req, 'iocs')))[0] == 400
        assert case.iocs_file.read_bytes() == before
    assert req('PATCH', 'iocs', dict(tipo='dominio', valor='teste.invalid', confianca='descartado', motivo='outro: documentado', versao=version(req, 'iocs')))[0] == 200
    rows = [json.loads(line) for line in (case.path / 'auditoria-ui.log').read_text(encoding='utf-8').splitlines()]
    assert len(rows) == 4
    assert {row['alvo'] for row in rows} == {'achados.md', 'limitacoes.md', 'iocs.csv'}


def test_atomic_failure_preserves_original(workbench, monkeypatch):
    from perito import _atomic
    case, req = workbench
    before = (case.path / 'hipoteses.md').read_bytes()
    names = {p.name for p in case.path.iterdir()}
    def fail_replace(*args):
        raise OSError('Falha sintética da substituição')
    monkeypatch.setattr(_atomic.os, 'replace', fail_replace)
    assert req('POST', 'hipoteses', dict(titulo='Teste', confianca='baixa', versao=version(req, 'hipoteses')))[0] == 500
    assert (case.path / 'hipoteses.md').read_bytes() == before
    assert {p.name for p in case.path.iterdir()} == names


def test_existing_table_header_is_preserved_and_duplicate_ioc_audited(workbench):
    case, req = workbench
    path = case.path / 'limitacoes.md'
    path.write_text('| # | Limitação | Impacto | Mitigar |\n|---|---|---|---|\n| L1 | Teste | Teste | Teste |\n', encoding='utf-8')
    assert req('POST', 'limitacoes', dict(limitacao='Nova', impacto='Novo', mitigacao='Nova', versao=version(req, 'doc/limitacoes')))[1]['id'] == 'L2'
    assert path.read_text(encoding='utf-8').count('| # |') == 1
    item = dict(tipo='ip', valor='203.0.113.9')
    for _ in range(2):
        assert req('POST', 'iocs', dict(**item, versao=version(req, 'iocs')))[0] == 200
    audit = [json.loads(line) for line in (case.path / 'auditoria-ui.log').read_text(encoding='utf-8').splitlines()]
    assert len(audit) == 3
    assert audit[-1]['versao_antes'] == audit[-1]['versao_depois']
