"""Executor HTTP inteiramente offline: provedores são sempre scripts Python locais."""
import json
import os
import time
from http.client import HTTPConnection
from pathlib import Path
from threading import Thread

import pytest

from perito import case as cases
from perito.ui.server import create_server
from perito.ui.jobs import JobManager


@pytest.fixture
def bench(tmp_path, monkeypatch):
    stub = tmp_path / 'stub.py'
    stub.write_text('print("stub sem operação", flush=True)', encoding='utf-8')
    # Até os testes de validação não podem descobrir um provedor real.
    monkeypatch.setenv('PERITO_CLAUDE_BIN', str(stub))
    monkeypatch.setenv('PERITO_CODEX_BIN', str(stub))
    case = cases.create_case('TESTE-007', base=tmp_path / 'casos')
    server = create_server(case.path.parent, port=0, token='teste')
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def req(method, route, data=None, *, accepted=True, token=True):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['X-Perito-Token'] = 'teste'
        if accepted:
            headers['X-Perito-Aviso-Envio'] = 'aceito'
        conn = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
        conn.request(method, route, json.dumps(data).encode() if data is not None else b'', headers)
        response = conn.getresponse()
        result = response.status, json.loads(response.read())
        conn.close()
        return result

    yield case, stub, req, server
    server.jobs.close()
    server.shutdown()
    server.server_close()
    thread.join()


def start(req, **kwargs):
    return req('POST', '/api/casos/TESTE-007/agentes', {'acao': 'resumo', 'agente': 'codex', **kwargs})


def finish(req, job):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        status, body = req('GET', '/api/agentes/' + job)
        assert status == 200
        if body['status'] != 'rodando':
            return body
        time.sleep(.02)
    pytest.fail('Job não terminou')


EDIT = '''import os, pathlib, sys, json
root = pathlib.Path(os.environ['PERITO_CASOS'])
case = root / 'TESTE-007'
(case / 'caso.md').write_text('# Rascunho\\n', encoding='utf-8')
print('linha um', flush=True)
print('linha dois', flush=True)
print(json.dumps(sys.argv), flush=True)
'''


@pytest.mark.parametrize('agent', ['claude', 'codex'])
def test_staging_apply_logs_and_history(bench, agent):
    case, stub, req, server = bench
    stub.write_text(EDIT, encoding='utf-8')
    original = (case.path / 'caso.md').read_bytes()
    status, body = start(req, agente=agent, instrucao_extra='Verifique a conta.')
    assert status == 200 and body['status'] == 'rodando'
    job = body['job']
    result = finish(req, job)
    assert result['status'] == 'concluido', result['mensagem']
    assert result['aplicado'] is False
    assert result['arquivos_alterados'] == ['caso.md']
    assert '+# Rascunho' in result['diff']
    assert (case.path / 'caso.md').read_bytes() == original
    assert 'linha um' in result['linhas']
    tail = req('GET', f'/api/agentes/{job}?desde=1')[1]
    assert tail['linhas'] == result['linhas'][1:]
    assert tail['proxima'] == result['proxima']
    assert req('GET', f'/api/agentes/{job}?desde=-1')[0] == 400
    log = (case.path / f'agentes/{job}.raw.log').read_text(encoding='utf-8')
    argv = json.loads(log.splitlines()[-1])
    prompt = argv[-1] if agent == 'codex' else argv[argv.index('-p') + 1]
    assert '<<<\nVerifique a conta.\n>>>' in prompt
    assert 'Verifique a conta.' not in argv
    assert str(server.jobs.jobs[job].draft) in prompt
    draft = server.jobs.jobs[job].draft
    assert not (draft / 'custodia.csv').exists()
    assert not (draft / 'evidencias').exists()
    for directory in ('normalizado', 'timeline', 'revisoes', 'relatorios'):
        assert (draft / directory).is_dir()
    assert req('GET', '/api/casos/TESTE-007/agentes')[1][0]['job'] == job
    assert req('POST', f'/api/agentes/{job}/aplicar', {'arquivos': ['caso.md']})[0] == 200
    assert (case.path / 'caso.md').read_text(encoding='utf-8') == '# Rascunho\n'
    audit = (case.path / 'auditoria-ui.log').read_text(encoding='utf-8')
    assert 'aplicar' in audit and job in audit and 'caso.md' in audit
    assert req('GET', f'/api/agentes/{job}')[1]['aplicado'] is True


def test_conflict_is_all_or_nothing_and_discard(bench):
    case, stub, req, server = bench
    stub.write_text(EDIT + "(case / 'achados.md').write_text('rascunho', encoding='utf-8')", encoding='utf-8')
    job = start(req, acao='investigar-fase', parametro='execucao')[1]['job']
    finish(req, job)
    findings = (case.path / 'achados.md').read_bytes()
    (case.path / 'caso.md').write_text('editado pelo analista', encoding='utf-8')
    status, body = req('POST', f'/api/agentes/{job}/aplicar', {'arquivos': ['achados.md', 'caso.md']})
    assert status == 409 and 'caso.md' in str(body)
    assert (case.path / 'achados.md').read_bytes() == findings
    draft = server.jobs.jobs[job].draft.parent
    assert req('POST', f'/api/agentes/{job}/descartar', {})[0] == 200
    assert not draft.exists()
    assert req('POST', f'/api/agentes/{job}/aplicar', {'arquivos': ['caso.md']})[0] == 409


def test_validation_and_unavailable(bench, monkeypatch):
    _, _, req, _ = bench
    route = '/api/casos/TESTE-007/agentes'
    assert req('POST', route, {}, accepted=False)[0] == 428
    assert req('POST', route, {}, token=False)[0] == 403
    for args in ({'acao': 'shell'}, {'agente': 'outro'}, {'instrucao_extra': 'a' * 600},
                 {'instrucao_extra': 'a\nb'}, {'parametro': 'execucao'},
                 {'acao': 'investigar-fase', 'parametro': 'outro'}, {'comando': 'ls'}):
        assert start(req, **args)[0] == 400
    monkeypatch.setenv('PERITO_CODEX_BIN', 'Z:/nao-existe.py')
    assert start(req)[0] == 400
    available = req('GET', '/api/agentes/disponiveis')[1]
    assert available['codex'] is False and available['claude'] is True
    assert len(available['acoes']) == 6
    assert req('GET', '/api/agentes/inexistente')[0] == 404


@pytest.mark.parametrize('timeout', [False, True])
def test_cancel_and_timeout(bench, monkeypatch, timeout):
    case, stub, req, server = bench
    stub.write_text('import time\nprint("iniciado", flush=True)\ntime.sleep(60)', encoding='utf-8')
    if timeout:
        monkeypatch.setenv('PERITO_AGENTE_TIMEOUT', '.15')
    job = start(req)[1]['job']
    assert start(req)[0] == 409
    if not timeout:
        assert req('POST', f'/api/agentes/{job}/cancelar', {})[0] == 200
    result = finish(req, job)
    assert result['status'] == ('tempo_esgotado' if timeout else 'cancelado'), result
    assert not server.jobs.jobs[job].draft.parent.exists()
    process = server.jobs.jobs[job].process
    assert process is None or process.poll() is not None


def test_real_raw_violation(bench):
    case, stub, req, _ = bench
    raw = case.raw_dir / 'x'
    stub.write_text(f'from pathlib import Path\nPath({str(raw)!r}).write_text("ataque")', encoding='utf-8')
    result = finish(req, start(req)[1]['job'])
    assert result['status'] == 'violacao'
    assert 'evidencias/brutas/x' in result['mensagem']
    assert 'violacao' in (case.path / 'auditoria-ui.log').read_text(encoding='utf-8')


def test_review_coverage_and_read_only_command(bench):
    case, stub, req, server = bench
    stub.write_text('''import os, pathlib, sys
case = pathlib.Path(os.environ['PERITO_CASOS']) / 'TESTE-007'
assert (case / 'revisoes/resumo-cobertura.md').is_file()
assert sys.argv[sys.argv.index('-s') + 1] == 'read-only'
pathlib.Path(sys.argv[sys.argv.index('-o') + 1]).write_text('# Revisão', encoding='utf-8')
print('cobertura recebida')
''', encoding='utf-8')
    job = start(req, acao='revisao-cruzada')[1]['job']
    result = finish(req, job)
    assert result['status'] == 'concluido', result['mensagem']
    assert 'revisoes/resumo-cobertura.md' in result['arquivos_alterados']
    assert any(p.startswith('revisoes/codex-') for p in result['arquivos_alterados'])
    assert not (case.path / 'revisoes/resumo-cobertura.md').exists()


def test_resume_draft_after_restart(bench):
    case, stub, req, server = bench
    stub.write_text(EDIT, encoding='utf-8')
    job = start(req)[1]['job']
    finish(req, job)
    server.jobs.close()
    server.jobs = JobManager(case.path.parent)
    assert req('GET', f'/api/agentes/{job}')[1]['status'] == 'concluido'
    assert req('POST', f'/api/agentes/{job}/aplicar', {'arquivos': ['caso.md']})[0] == 200


def test_cleanup_expired_drafts_only(bench):
    case, stub, req, server = bench
    stub.write_text(EDIT, encoding='utf-8')
    job = start(req)[1]['job']
    finish(req, job)
    parent = server.jobs.jobs[job].draft.parent
    old = time.time() - 8 * 86400
    os.utime(parent, (old, old))
    original = (case.path / 'caso.md').read_bytes()
    server.jobs.close()
    server.jobs = JobManager(case.path.parent)
    assert not parent.exists()
    assert (case.path / 'caso.md').read_bytes() == original
    assert req('POST', f'/api/agentes/{job}/aplicar', {'arquivos': ['caso.md']})[0] == 409


def test_error_stream_json_and_target_whitelist(bench):
    case, stub, req, _ = bench
    stub.write_text('''import json, sys
print(json.dumps({'type': 'assistant', 'message': {'content': [
    {'type': 'text', 'text': 'Analisando'},
    {'type': 'tool_use', 'name': 'Edit', 'input': {'file_path': 'caso.md'}}]}}))
print(json.dumps({'type': 'result', 'result': 'Falhou'}))
print('erro de ferramenta', file=sys.stderr)
sys.exit(2)
''', encoding='utf-8')
    result = finish(req, start(req, agente='claude')[1]['job'])
    assert result['status'] == 'erro'
    assert result['linhas'] == ['Analisando', 'Editando caso.md', 'Falhou', 'erro de ferramenta']
    stub.write_text(EDIT + "(case / 'escopo.md').write_text('fora do alvo')", encoding='utf-8')
    job = start(req)[1]['job']
    result = finish(req, job)
    assert result['status'] == 'violacao'
    assert req('POST', f'/api/agentes/{job}/aplicar', {'arquivos': ['escopo.md']})[0] == 409
    assert 'violacao' in (case.path / 'auditoria-ui.log').read_text(encoding='utf-8')


def test_diff_limit_and_draft_tampering(bench):
    _, stub, req, server = bench
    stub.write_text(EDIT + "(case / 'caso.md').write_text('á' * 220000, encoding='utf-8')", encoding='utf-8')
    job = start(req)[1]['job']
    result = finish(req, job)
    assert result['status'] == 'concluido'
    assert 0 < len(result['diff'].encode('utf-8')) <= 200 * 1024
    (server.jobs.jobs[job].draft / 'caso.md').write_text('adulterado', encoding='utf-8')
    assert req('POST', f'/api/agentes/{job}/aplicar', {'arquivos': ['caso.md']})[0] == 409


def test_snapshot_sha_detects_same_size_and_time(bench):
    case, stub, req, _ = bench
    raw = case.raw_dir / 'x'
    raw.write_text('abc')
    before = raw.stat()
    stub.write_text(f'''import os
from pathlib import Path
path = Path({str(raw)!r})
path.write_text('xyz')
os.utime(path, ns=({before.st_atime_ns}, {before.st_mtime_ns}))
''', encoding='utf-8')
    result = finish(req, start(req)[1]['job'])
    assert result['status'] == 'violacao'


@pytest.mark.parametrize('cancel', [False, True])
def test_children_do_not_survive_job(bench, cancel):
    _, stub, req, _ = bench
    marker = stub.parent / 'orphan.txt'
    child = f"import time; from pathlib import Path; time.sleep(1.5); Path({str(marker)!r}).write_text('órfão')"
    stub.write_text(f'''import subprocess, sys, time
subprocess.Popen([sys.executable, '-c', {child!r}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print('filho iniciado', flush=True)
{'time.sleep(60)' if cancel else ''}
''', encoding='utf-8')
    job = start(req)[1]['job']
    if cancel:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if req('GET', f'/api/agentes/{job}')[1]['linhas']:
                break
            time.sleep(.02)
        req('POST', f'/api/agentes/{job}/cancelar', {})
    finish(req, job)
    time.sleep(1.8)
    assert not marker.exists(), 'Processo filho sobreviveu ao término do job'
