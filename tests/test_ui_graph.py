import copy

import pytest

from perito import timeline
from perito.case import create_case
from perito.parsers import parse_file
from perito.schema import Event
from perito.ui.api import TimelineCache, dispatch
from test_detect import FILES, SAMPLES
from test_ui_api import dossier, http_server


@pytest.fixture
def graph_case(tmp_path):
    case = create_case('GRAFO-001', base=tmp_path)
    events = [e for name, (source, _) in FILES.items()
              for e in parse_file(SAMPLES / name, source)]
    (case.normalized_dir / 'events.jsonl').write_text(
        ''.join(e.to_json() + '\n' for e in events), encoding='utf-8')
    return tmp_path, case, timeline.build(events)


def graph_data(graph_case, query=None, cache=None):
    status, data = dispatch(graph_case[0], '/api/casos/GRAFO-001/grafo', query or {}, cache=cache)
    assert status == 200, data
    return data


def test_synthetic_edges_and_cloud(graph_case):
    data = graph_data(graph_case)
    edges = {(e['origem'], e['destino'], e['tipo']): e for e in data['arestas']}
    nodes = {n['id']: n for n in data['nos']}
    assert edges['email:faturas@pagamentos-fornecedor.example', 'conta:m.silva', 'email']['suspeita']
    assert edges['conta:m.silva', 'host:ws-fin-023', 'logon']
    rdp = edges['host:ws-fin-023', 'host:srv-file-01', 'rdp']
    assert rdp['suspeita'] and 'svc_backup' in rdp['contas']
    exfil = edges['host:srv-file-01', 'dominio:bkp.example-storage.net', 'rede_externa']
    assert exfil['volume_alto'] and exfil['bytes_out'] == 2469606194
    assert exfil['rotulo'] == 'enviou 2,5 GB'
    assert '198.51.100.200' in nodes['dominio:bkp.example-storage.net']['ips']
    assert edges['host:ws-fin-023', 'dominio:cdn-update.example-cdn.net', 'rede_externa']['suspeita']
    signin = edges['ip:198.51.100.77', 'conta:m.silva', 'signin']
    assert (signin['falha'], signin['sucesso']) == (3, 2)
    assert signin['rotulo'] == '3 MFA negados, 2 logins'
    assert edges['ip:198.51.100.77', 'conta:m.silva', 'mfa']['rotulo'] == 'novo dispositivo MFA'
    assert edges['conta:m.silva', 'app:MailSync Pro', 'consent']['suspeita']
    assert nodes['ip:198.51.100.77']['coluna'] == 'entrada'
    assert nodes['host:srv-file-01']['flags']['sem_edr']
    assert not nodes['host:ws-fin-023']['flags']['sem_edr']
    assert nodes['conta:m.silva']['flags']['nuvem']
    assert nodes['conta:m.silva']['flags']['onprem']


def test_indices_path_relevance_and_purity(graph_case):
    from perito.ui.graph import build_graph
    events = graph_case[2]
    before = copy.deepcopy(events)
    data = build_graph(events, timeline.coverage(events)['hosts_sem_edr'])
    assert events == before
    assert data == build_graph(events, timeline.coverage(events)['hosts_sem_edr'])
    for edge in data['arestas']:
        assert all(events[idx].raw_ref in edge['raw_refs'] for idx in edge['idxs'])
        assert edge['contagem'] == len(edge['idxs'])
    expected = sorted((e for e in data['arestas'] if e['suspeita']), key=lambda e: e['primeira'])
    assert data['caminho'] == [e['id'] for e in expected]
    relevant = graph_data(graph_case, {'relevantes': '1'})
    seeds = {n['id'] for n in data['nos'] if n['relevante']}
    neighbors = seeds | {endpoint for e in data['arestas']
                         if e['origem'] in seeds or e['destino'] in seeds
                         for endpoint in (e['origem'], e['destino'])}
    assert {n['id'] for n in relevant['nos']} == neighbors
    assert all(e['origem'] in neighbors and e['destino'] in neighbors for e in relevant['arestas'])
    for e in data['arestas']:
        if any(noise in e['origem'] or noise in e['destino'] for noise in ('www.office.com', 'j.souza', 'dc01$')):
            assert not e['suspeita']
    assert build_graph([], []) == {'nos': [], 'arestas': [], 'caminho': []}


def test_graph_cache_readonly_and_domain_api(graph_case, monkeypatch):
    base, case, events = graph_case
    before = {p: p.read_bytes() for p in base.rglob('*') if p.is_file()}
    cache = TimelineCache()
    graph_data(graph_case, cache=cache)
    def unexpected(*args):
        pytest.fail('Timeline reconstruída apesar do cache')
    monkeypatch.setattr(timeline, 'build', unexpected)
    graph_data(graph_case, cache=cache)
    status, data = dispatch(base, '/api/casos/GRAFO-001/eventos', {'dominio': 'EXAMPLE-CDN'}, cache=cache)
    assert status == 200 and data['eventos']
    assert all('example-cdn' in e['domain'].lower() for e in data['eventos'])
    assert {p: p.read_bytes() for p in base.rglob('*') if p.is_file()} == before


def test_graph_http_protections(http_server):
    server, get, _ = http_server
    route = '/api/casos/TESTE-001/grafo'
    assert get(route)[0] == 403
    assert get(route, headers={'X-Perito-Token': 'errado'})[0] == 403
    headers = {'X-Perito-Token': 'segredo'}
    assert get(route, headers=headers)[0] == 200
    assert get(route, headers={**headers, 'Host': 'evil.example'})[0] == 403
    assert get(route, method='POST', headers=headers)[0] == 405


@pytest.mark.parametrize('port,kind', [(3389, 'rdp'), (445, 'smb'), (5985, 'winrm'), (5986, 'winrm'), (22, 'ssh')])
def test_internal_network_protocols(port, kind):
    from perito.ui.graph import build_graph
    ev = Event('2026-11-10T13:00:00.000Z', 'splunk', 'network', 'net.csv:2',
               host='ws', dst_ip='10.0.0.2', dst_port=port, extra={'dst_host': 'srv'})
    edge, = build_graph([ev], [])['arestas']
    assert (edge['origem'], edge['destino'], edge['tipo']) == ('host:ws', 'host:srv', kind)
    assert not edge['suspeita']


def test_dns_resolution_observer_and_unmapped_ip():
    from perito.ui.graph import build_graph
    def event(ref, **kwargs):
        return Event('2026-11-10T13:00:00.000Z', 'elastic', 'dns', ref, **kwargs)
    events = [
        event('dns:1', host='ws', dst_ip='198.51.100.1'),
        event('dns:2', dst_ip='198.51.100.1', domain='cdn.example.test', extra={'observer': 'sensor'}),
        event('dns:3', dst_ip='198.51.100.1', extra={'observer': 'sensor', 'src_host': 'ws'}),
        event('dns:4', host='ws', dst_ip='203.0.113.2'),
        event('dns:5', host='ws', dst_ip='10.0.0.2', domain='internal.local'),
    ]
    data = build_graph(events, [])
    assert len(data['arestas']) == 2
    domain, unmapped = data['arestas']
    assert domain['destino'] == 'dominio:cdn.example.test'
    assert domain['idxs'] == [0, 2] and domain['contagem'] == 2
    assert unmapped['destino'] == 'ip:203.0.113.2'
    assert next(n for n in data['nos'] if n['id'] == unmapped['destino'])['coluna'] == 'saida'


def test_relevant_neighbors_do_not_expand_recursively():
    from perito.ui.graph import build_graph, relevant_graph
    events = [Event('2026-11-10T13:00:00.000Z', 'sentinel', 'logon', f'logon:{idx}',
                    host=target, user='ana', outcome='success',
                    mitre=['T1021.001'] if idx == 0 else [], extra={'src_host': source})
              for idx, (source, target) in enumerate([('a', 'b'), ('b', 'c'), ('c', 'd')])]
    data = relevant_graph(build_graph(events, []))
    assert 'host:c' in {n['id'] for n in data['nos']}
    assert 'host:d' not in {n['id'] for n in data['nos']}
    assert len(data['arestas']) == 2
