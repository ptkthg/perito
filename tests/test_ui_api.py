import json
import os
from http.client import HTTPConnection
from pathlib import Path
from threading import Thread

import pytest

from perito.case import create_case
from perito.cli import main
from perito.schema import Event


@pytest.fixture
def dossier(tmp_path):
    case = create_case('TESTE-001', titulo='Teste da API', base=tmp_path)
    rows = [
        Event('2026-11-10T13:00:05.000Z', 'defender', 'process', 'edr.csv:2', host='ws-01', user='ana', process='cmd.exe', mitre=['T1059.003']),
        Event('2026-11-10T13:01:05.000Z', 'sentinel', 'audit', 'audit.json#0', host='srv-01', user='ana', action='1102'),
        Event('2026-11-10T13:02:05.000Z', 'splunk', 'network', 'net.csv:2', host='srv-01', dst_ip='198.51.100.77', extra={'bytes_out': 200 * 1024**2}),
    ]
    (case.normalized_dir / 'events.jsonl').write_text(''.join(e.to_json() + '\n' for e in rows), encoding='utf-8')
    (case.path / 'hipoteses.md').write_text('''# Hipóteses
## H1: <título>
- **Status:** aberta
## H2: Credencial obtida
- **Status:** Confirmada
- **Confianca:** alta
- **Fase ATT&CK:** credenciais
- **Sustentação ([EVIDÊNCIA] com raw_ref):** edr.csv:15-17 e A6
- **Confirmaria:** audit.json#0
- **Refutaria:** nada
- **Próximo passo:** verificar
## H3: Incompleta
''', encoding='utf-8')
    (case.path / 'achados.md').write_text('''| # | UTC | Host | Conta | Achado | ATT&CK | Evidência |
|---|---|---|---|---|---|---|
| A6 | 2026-11-10T13:00:05.000Z | ws-01 | ana | Texto \\| literal | T1003.001; T1059 | edr.csv:15-17; audit.json#0 |
''', encoding='utf-8')
    (case.path / 'limitacoes.md').write_text('| # | Limitação | Impacto | Mitigar |\n|---|---|---|---|\n| L1 | Sem EDR | Lacuna | Coletar |\n', encoding='utf-8')
    (case.path / 'revisoes' / 'codex-01.md').write_text('Revisão', encoding='utf-8')
    return tmp_path, case


def request_api(dossier, route='', query=None, cache=None):
    from perito.ui.api import dispatch
    return dispatch(dossier[0], '/api/casos/TESTE-001' + route, query or {}, cache=cache)


def test_contract_cases_summary_and_readonly(dossier):
    from perito.ui.api import dispatch
    base, case = dossier
    before = {p.relative_to(base): p.read_bytes() for p in base.rglob('*') if p.is_file()}
    status, rows = dispatch(base, '/api/casos', {})
    assert status == 200
    assert rows == [{'id': 'TESTE-001', 'titulo': 'Teste da API', 'fase': 'Detectar / Identification', 'evidencias': 0, 'eventos': 3}]
    status, data = request_api(dossier, '/resumo')
    assert status == 200 and data['total_eventos'] == 3
    assert data['custodia'] == {'integra': True, 'arquivos': 0, 'problemas': []}
    assert data['contagens'] == {'hipoteses': 2, 'achados': 1, 'limitacoes': 1, 'iocs_registrados': 0}
    assert data['hosts_sem_edr'] == ['srv-01']
    assert data['tecnicas'] == sorted(data['tecnicas'], key=lambda t: (t['tatica'], t['id']))
    assert {p.relative_to(base): p.read_bytes() for p in base.rglob('*') if p.is_file()} == before


def test_events_filters_stable_indices_and_limit(dossier):
    status, data = request_api(dossier, '/eventos', {'fonte': ['sentinel,splunk'], 'excluir_tipo': ['process'], 'limite': ['1']})
    assert status == 200 and data['total'] == 3 and data['filtrados'] == 2
    assert [e['idx'] for e in data['eventos']] == [1]
    assert data['eventos'][0]['raw_ref'] == 'audit.json#0'
    assert request_api(dossier, '/eventos', {'excluir_host': ['WS-01.local', 'srv-01']})[1]['filtrados'] == 0
    assert request_api(dossier, '/eventos', {'excluir_user': ['DOM\\ANA'], 'excluir_ip': ['198.51.100.77']})[1]['filtrados'] == 0
    assert request_api(dossier, '/eventos', {'excluir_fonte': ['defender'], 'excluir_tipo': ['audit']})[1]['eventos'][0]['idx'] == 2
    assert request_api(dossier, '/eventos', {'de': ['2026-11-10T13:01:00Z'], 'ate': ['2026-11-10T13:02:00Z']})[1]['filtrados'] == 1


@pytest.mark.parametrize('query', [{'limite': ['-1']}, {'limite': ['abc']}, {'de': ['inválida']}, {'bucket': ['0']}, {'bucket': ['x']}])
def test_bad_queries(dossier, query):
    route = '/histograma' if 'bucket' in query else '/eventos'
    status, data = request_api(dossier, route, query)
    assert status == 400 and 'erro' in data


def test_histogram_coverage_markers_and_empty(dossier):
    status, data = request_api(dossier, '/histograma', {'bucket': ['60'], 'fonte': ['sentinel']})
    assert status == 200 and data['bucket_s'] == 60
    assert data['inicio'] == '2026-11-10T13:01:00.000Z'
    assert data['n_baldes'] == 1 and data['fontes'] == {'sentinel': [1]}
    assert set(data['cobertura']) == {'defender', 'sentinel', 'splunk'}
    assert data['marcas'] == [{'ts': '2026-11-10T13:01:05.000Z', 'tipo': 'log_limpo', 'raw_ref': 'audit.json#0'}]
    all_data = request_api(dossier, '/histograma', {'bucket': ['60']})[1]
    assert all_data['n_baldes'] == 3
    assert all_data['fontes']['splunk'] == [0, 0, 1]
    assert all_data['marcas'][-1]['tipo'] == 'volume_alto'
    empty = request_api(dossier, '/histograma', {'host': ['ausente']})[1]
    assert empty['n_baldes'] == 0 and empty['inicio'] is None and empty['fim'] is None


def test_docs_and_markdown_parsers(dossier):
    status, docs = request_api(dossier, '/docs')
    assert status == 200 and len(docs) == 8
    assert all(d['mtime'].endswith('Z') for d in docs)
    status, doc = request_api(dossier, '/doc/revisoes/codex-01.md')
    assert status == 200 and doc['conteudo'] == 'Revisão' and doc['grupo'] == 'revisoes'
    status, hypotheses = request_api(dossier, '/hipoteses')
    assert status == 200 and [h['id'] for h in hypotheses] == ['H2', 'H3']
    assert hypotheses[0]['linha'] == 4 and hypotheses[0]['status'] == 'confirmada'
    assert hypotheses[0]['refs'] == ['edr.csv:15-17', 'A6', 'audit.json#0']
    assert hypotheses[0]['confianca'] == 'alta' and hypotheses[0]['sustentacao'].startswith('edr.csv')
    assert hypotheses[1]['status'] is None and hypotheses[1]['refs'] == []
    status, findings = request_api(dossier, '/achados')
    assert status == 200 and findings[0]['linha'] == 3
    assert findings[0]['attack'] == ['T1003.001', 'T1059']
    assert findings[0]['evidencia'] == ['edr.csv:15-17', 'audit.json#0']
    assert findings[0]['achado'] == 'Texto | literal'


def test_entities_iocs_and_route_errors(dossier):
    assert request_api(dossier, '/entidades')[1]['host']['srv-01']['eventos'] == 2
    assert request_api(dossier, '/iocs')[1]['registrados'] == []
    assert request_api(dossier, '/iocs')[1]['candidatos'][0]['valor'] == '198.51.100.77'
    for path in ['/doc/../custodia.csv', '/doc/custodia', '/doc/revisoes/../caso.md', '/desconhecido']:
        assert request_api(dossier, path)[0] in (400, 404)
    from perito.ui.api import dispatch
    assert dispatch(dossier[0], '/api/casos/%2e%2e/resumo', {})[0] == 400
    assert dispatch(dossier[0], '/api/casos/AUSENTE/resumo', {})[0] == 404


def test_cache_invalidates_and_reuses(dossier, monkeypatch):
    from perito.ui import api
    cache = api.TimelineCache()
    assert request_api(dossier, '/eventos', cache=cache)[1]['total'] == 3
    original = api.timeline.build
    def unexpected(*args):
        pytest.fail('Cache não reutilizado')
    monkeypatch.setattr(api.timeline, 'build', unexpected)
    assert request_api(dossier, '/eventos', cache=cache)[1]['total'] == 3
    monkeypatch.setattr(api.timeline, 'build', original)
    file = dossier[1].normalized_dir / 'events.jsonl'
    with file.open('a', encoding='utf-8') as fh:
        fh.write(Event('2026-11-10T13:03:00.000Z', 'wazuh', 'other', 'new.json:1').to_json() + '\n')
    os.utime(file, ns=(file.stat().st_atime_ns, file.stat().st_mtime_ns + 1000000000))
    assert request_api(dossier, '/eventos', cache=cache)[1]['total'] == 4
    file.unlink()
    assert request_api(dossier, '/eventos', cache=cache)[1]['total'] == 0


@pytest.fixture
def http_server(dossier, tmp_path):
    from perito.ui.server import create_server
    static = tmp_path / 'static'
    static.mkdir()
    (static / 'index.html').write_text('<html>__PERITO_TOKEN__</html>', encoding='utf-8')
    (static / 'app.js').write_text('let x = 1;', encoding='utf-8')
    server = create_server(dossier[0], port=0, token='segredo', static_dir=static)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    def get(path='/', method='GET', headers=None):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result
    yield server, get, static
    server.shutdown()
    thread.join()
    server.server_close()


def test_http_token_host_headers_and_static(http_server):
    server, get, static = http_server
    assert server.server_address[0] == '127.0.0.1'
    for path in ['/', '/caso/TESTE-001', '/app.js', '/api/casos', '/ausente.js']:
        status, headers, body = get(path)
        assert headers['X-Content-Type-Options'] == 'nosniff'
        assert headers['Referrer-Policy'] == 'no-referrer'
        assert "frame-ancestors 'none'" in headers['Content-Security-Policy']
        assert get(path, headers={'Host': 'evil.example'})[0] == 403
    assert get('/')[2] == b'<html>segredo</html>'
    assert get('/caso/TESTE-001')[2] == get('/')[2]
    assert 'javascript' in get('/app.js')[1]['Content-Type']
    assert json.loads(get('/api/casos')[2]) == {'erro': 'token inválido'}
    assert get('/api/casos', headers={'X-Perito-Token': 'errado'})[0] == 403
    status, headers, body = get('/api/casos', headers={'X-Perito-Token': 'segredo', 'Host': f'localhost:{server.server_port}'})
    assert status == 200 and headers['Cache-Control'] == 'no-store'
    assert json.loads(body)[0]['id'] == 'TESTE-001'
    for host in ['localhost', '127.0.0.1:1', f'evil:{server.server_port}']:
        assert get('/', headers={'Host': host})[0] == 403
    for path in ['/../caso.md', '/%2e%2e/caso.md', '/..%5ccaso.md']:
        assert get(path)[0] in (403, 404)
    (static / 'index.html').unlink()
    assert b'Frontend n' in get('/')[2] and get('/')[0] == 200


@pytest.mark.parametrize('method', ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'TRACE', 'CUSTOM'])
def test_api_readonly_methods(http_server, method):
    _, get, _ = http_server
    assert get('/api/casos', method, {'X-Perito-Token': 'segredo'})[0] == 405


def test_cli_ui_options_and_occupied_port(dossier, monkeypatch, capsys):
    from perito.ui import server
    import socket
    calls = []
    monkeypatch.setattr(server, 'run', lambda **kw: calls.append(kw) or 0)
    assert main(['--casos', str(dossier[0]), 'ui', '--porta', '8877', '--caso', 'TESTE-001', '--sem-navegador', '--token', 'dev']) == 0
    assert calls[0]['port'] == 8877 and calls[0]['case_id'] == 'TESTE-001' and calls[0]['open_browser'] is False
    monkeypatch.undo()
    with socket.socket() as occupied:
        occupied.bind(('127.0.0.1', 0))
        occupied.listen()
        assert main(['ui', '--porta', str(occupied.getsockname()[1]), '--sem-navegador']) == 1
    assert '--porta' in capsys.readouterr().err


@pytest.mark.parametrize('query', [
    {'host': 'WS-01.local'}, {'user': 'DOM\\ANA'}, {'ip': '198.51.100.77'},
    {'hash': 'a' * 64}, {'dominio': 'example.test'}, {'texto': 'ausente'},
    {'fonte': 'defender,sentinel'}, {'tipo': 'audit,network'},
])
def test_api_preserves_timeline_filter_semantics(dossier, query):
    from perito import timeline
    events = timeline.build(timeline.load_events(dossier[1]))
    aliases = {'hash': 'sha256', 'dominio': 'domain'}
    expected = timeline.filter_events(events, **{aliases.get(k, k): v for k, v in query.items()})
    status, data = request_api(dossier, '/eventos', query)
    assert status == 200
    assert [{k: v for k, v in row.items() if k != 'idx'} for row in data['eventos']] == [ev.to_dict() for ev in expected]


def test_empty_case_contract(tmp_path):
    from perito.ui.api import dispatch
    create_case('VAZIO-001', base=tmp_path)
    root = '/api/casos/VAZIO-001/'
    assert dispatch(tmp_path, root + 'hipoteses', {}) == (200, [])
    assert dispatch(tmp_path, root + 'achados', {}) == (200, [])
    summary = dispatch(tmp_path, root + 'resumo', {})[1]
    assert summary['total_eventos'] == 0
    assert summary['janela'] == {'primeiro': None, 'ultimo': None}
    assert summary['contagens'] == dict(hipoteses=0, achados=0, limitacoes=0, iocs_registrados=0)
    histogram = dispatch(tmp_path, root + 'histograma', {})[1]
    assert histogram == dict(bucket_s=1, inicio=None, fim=None, n_baldes=0, fontes={}, cobertura={}, marcas=[])


def test_summary_checks_custody_and_registered_iocs(dossier, tmp_path):
    from perito.case import add_evidence
    source = tmp_path / 'evidence.txt'
    source.write_text('Evidência sintética', encoding='utf-8')
    add_evidence(dossier[1], source)
    summary = request_api(dossier, '/resumo')[1]
    assert summary['custodia'] == dict(integra=True, arquivos=1, problemas=[])
    # Simula arquivo ausente pelo registro, sem alterar a evidência bruta.
    with dossier[1].custody_file.open('a', encoding='utf-8') as fh:
        fh.write('2026-11-10T13:00:00Z,missing.csv,abc,1,defender,teste,ausente\n')
    summary = request_api(dossier, '/resumo')[1]
    assert summary['custodia']['integra'] is False
    assert summary['custodia']['problemas'] == [('missing.csv', 'ausente')]
    with dossier[1].iocs_file.open('a', encoding='utf-8') as fh:
        fh.write('ip,198.51.100.77,2026-11-10T13:00:00Z,2026-11-10T13:00:00Z,splunk,teste,alta\n')
    assert request_api(dossier, '/resumo')[1]['contagens']['iocs_registrados'] == 1
    assert request_api(dossier, '/iocs')[1]['registrados'][0]['confianca'] == 'alta'


def test_synthetic_samples_integration(tmp_path, capsys):
    from perito.ui.api import dispatch
    samples = Path(__file__).resolve().parents[1] / 'samples' / 'caso-sintetico'
    assert main(['--casos', str(tmp_path), 'novo-caso', 'AMOSTRA-001']) == 0
    assert main(['--casos', str(tmp_path), 'ingerir', 'AMOSTRA-001', str(samples)]) == 0
    capsys.readouterr()
    status, summary = dispatch(tmp_path, '/api/casos/AMOSTRA-001/resumo', {})
    assert status == 200 and summary['total_eventos'] == 50
    assert summary['custodia'] == dict(integra=True, arquivos=7, problemas=[])
    assert len(summary['por_fonte']) == 7
    assert 'T1003.001' in [t['id'] for t in summary['tecnicas']]


def test_token_precedence_generation_and_startup_output(dossier, monkeypatch, capsys):
    from perito.ui import server
    monkeypatch.delenv('PERITO_UI_TOKEN', raising=False)
    generated = []
    monkeypatch.setattr(server.secrets, 'token_urlsafe', lambda size: generated.append(size) or 'generated')
    instance = server.create_server(dossier[0], port=0)
    try:
        assert instance.token == 'generated' and generated == [24]
    finally:
        instance.server_close()
    monkeypatch.setenv('PERITO_UI_TOKEN', 'environment')
    for explicit, expected in [(None, 'environment'), ('explicit', 'explicit')]:
        instance = server.create_server(dossier[0], port=0, token=explicit)
        try:
            assert instance.token == expected
        finally:
            instance.server_close()
    monkeypatch.setattr(server.ThreadingHTTPServer, 'serve_forever', lambda self: None)
    opened = []
    monkeypatch.setattr(server.webbrowser, 'open', lambda url: opened.append(url))
    assert server.run(case_base=dossier[0], port=0, case_id='TESTE-001', token='supersecret') == 0
    output = capsys.readouterr().out
    assert 'PERITO UI em http://127.0.0.1:' in output and '/#/caso/TESTE-001' in output
    assert 'token de desenvolvimento ativo' in output
    assert 'supersecret' not in output and 'supersecret' not in opened[0]


def test_http_missing_duplicate_host_and_api_errors(http_server):
    server, get, _ = http_server
    connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
    connection.putrequest('GET', '/', skip_host=True)
    connection.endheaders()
    response = connection.getresponse()
    assert response.status == 403
    response.read()
    connection.close()
    connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
    connection.putrequest('GET', '/')
    connection.putheader('Host', f'localhost:{server.server_port}')
    connection.endheaders()
    response = connection.getresponse()
    assert response.status == 403
    response.read()
    connection.close()
    auth = {'X-Perito-Token': 'segredo'}
    assert get('/api/casos/%2e%2e/resumo', headers=auth)[0] == 400
    assert get('/api/casos/TESTE-001/doc/revisoes/../caso.md', headers=auth)[0] == 400
    assert get('/api/casos/TESTE-001/eventos?limite=abc', headers=auth)[0] == 400
    assert get('/api/casos/AUSENTE/resumo', headers=auth)[0] == 404


def test_internal_read_error_is_json_500(dossier, monkeypatch):
    from perito.ui import api
    def broken(*args):
        raise PermissionError('Sem permissão para leitura')
    monkeypatch.setattr(api.timeline, 'load_events', broken)
    status, data = request_api(dossier, '/eventos')
    assert status == 500 and data['detalhe'] == 'Sem permissão para leitura'
