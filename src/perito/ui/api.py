"""Consultas somente leitura; sem dependência do transporte HTTP."""
from __future__ import annotations

import csv
import math
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from urllib.parse import unquote

from .. import case as cases
from .. import timeline
from .._atomic import version
from ..mitre import TECHNIQUES
from ..schema import parse_ts
from .graph import build_graph, relevant_graph

DOCUMENTS = ('caso', 'triagem', 'achados', 'hipoteses', 'escopo', 'limitacoes', 'acoes')
_DOCUMENT_FILE = re.compile(r'[A-Za-z0-9._-]+\.md\Z')
_REF = re.compile(r'(?<![\w.-])(?:[\w.-]+\.[A-Za-z0-9]+[:#]\d+(?:-\d+)?|A\d+)(?!\w)')
_FIELDS = {
    'status': 'status', 'confianca': 'confianca', 'fase att&ck': 'fase',
    'sustentacao': 'sustentacao', 'confirmaria': 'confirmaria',
    'refutaria': 'refutaria', 'proximo passo': 'proximo_passo',
    'contradiz': 'contradiz', 'justificativa': 'justificativa',
}

FORMATS = [
    {'fonte': name, 'descricao': description} for name, description in (
        ('auto', 'Detecção automática da fonte'),
        ('defender', 'Defender XDR Advanced Hunting (CSV/JSON)'),
        ('sentinel', 'Microsoft Sentinel (CSV/JSON)'),
        ('entra_signin', 'Microsoft Entra ID sign-in (CSV/JSON)'),
        ('entra_audit', 'Microsoft Entra ID audit (CSV/JSON)'),
        ('splunk', 'Splunk (CSV/JSON)'),
        ('elastic', 'Elastic / Elasticsearch (JSON/NDJSON)'),
        ('wazuh', 'Wazuh alerts (JSON/NDJSON)'),
    )
]


class TimelineCache:
    """Cache por caminho absoluto, compartilhável entre threads do servidor."""

    def __init__(self):
        self._entries = {}
        self._lock = RLock()

    def events(self, case):
        with self._lock:
            key = case.path.resolve()
            # Também detecta troca de nome e alterações que não mudam o maior mtime.
            signature = tuple((p.name, p.stat().st_mtime_ns, p.stat().st_size)
                              for p in sorted(case.normalized_dir.glob('*.jsonl')))
            entry = self._entries.get(key)
            if entry is None or entry[0] != signature:
                entry = signature, timeline.build(timeline.load_events(case))
                self._entries[key] = entry
            return entry[1]


def _read(path):
    return path.read_text(encoding='utf-8-sig') if path.is_file() else ''


def _csv(path):
    if not path.is_file():
        return []
    with path.open(encoding='utf-8-sig', newline='') as fh:
        return list(csv.DictReader(fh))


def _metadata(case):
    text = _read(case.path / 'caso.md')
    title = re.search(r'^# Caso [^:\n]+:\s*(.*)$', text, re.M)
    phase = re.search(r'\*\*Fase\s*\([^\n]*?\):\*\*\s*([^\n]*)', text)
    return {'id': case.case_id, 'titulo': title[1].strip() if title else '',
            'fase': phase[1].strip() if phase else ''}


def _plain(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.casefold())
                   if not unicodedata.combining(c))


def parse_hypotheses(text):
    """Preserva seções incompletas e a posição no Markdown original."""
    result = []
    current = None
    section = []

    def finish():
        if current is not None:
            current['refs'] = list(dict.fromkeys(_REF.findall('\n'.join(section))))
            result.append(current)

    active_field = None
    for line_number, line in enumerate(text.splitlines(), 1):
        heading = re.match(r'^##\s+(H\d+):\s*(.*)', line)
        if line.startswith('## '):
            finish()
            current, section, active_field = None, [], None
            if heading and not heading[2].strip().startswith('<'):
                current = dict.fromkeys(_FIELDS.values())
                current.update(id=heading[1], titulo=heading[2].strip(), linha=line_number)
        if current is None:
            continue
        section.append(line)
        bullet = re.match(r'^\s*-\s+\*\*([^:]+):\*\*\s*(.*)', line)
        if bullet:
            label = _plain(bullet[1]).split(' (', 1)[0].strip()
            active_field = _FIELDS.get(label)
            if active_field:
                value = bullet[2].strip() or None
                if active_field in ('status', 'confianca') and value:
                    normalized = _plain(value)
                    choices = {'aberta': 'aberta', 'confirmada': 'confirmada', 'refutada': 'refutada',
                               'inconclusiva': 'inconclusiva'} if active_field == 'status' else {'baixa': 'baixa', 'media': 'média', 'alta': 'alta'}
                    value = choices.get(normalized, value if active_field == 'status' else None)
                current[active_field] = value
        elif active_field and line[:1].isspace() and line.strip():
            current[active_field] = ((current[active_field] or '') + '\n' + line.strip()).strip()
    finish()
    return result


def _table_rows(text):
    for number, line in enumerate(text.splitlines(), 1):
        if not line.lstrip().startswith('|'):
            continue
        cells = [v.strip().replace('\\|', '|') for v in re.split(r'(?<!\\)\|', line.strip().strip('|'))]
        if cells and cells[0] and cells[0] != '#' and not re.fullmatch(r'[: -]+', cells[0]):
            yield number, cells


def parse_findings(text):
    result = []
    for number, cells in _table_rows(text):
        if len(cells) != 7 or not re.fullmatch(r'A?\d+', cells[0]):
            continue
        result.append(dict(id='A' + cells[0].removeprefix('A'), utc=cells[1], host=cells[2],
                           conta=cells[3], achado=cells[4],
                           attack=list(dict.fromkeys(re.findall(r'T\d{4}(?:\.\d{3})?', cells[5]))),
                           evidencia=[r.strip().strip('`') for r in cells[6].split(';') if r.strip()], linha=number))
    return result


def _document(case, name):
    if name in DOCUMENTS:
        group, path = 'caso', case.path / (name + '.md')
    else:
        parts = name.split('/')
        if len(parts) != 2 or parts[0] not in ('revisoes', 'relatorios') or not _DOCUMENT_FILE.fullmatch(parts[1]):
            raise ValueError('Nome de documento inválido.')
        group, path = parts[0], case.path / name
    if not path.resolve().is_relative_to(case.path.resolve()):
        raise ValueError('Documento fora do diretório do caso.')
    if not path.is_file():
        raise FileNotFoundError('Documento não encontrado.')
    return group, path


def _mtime(path):
    return parse_ts(datetime.fromtimestamp(path.stat().st_mtime, timezone.utc))


def _documents(case):
    names = [name for name in DOCUMENTS if (case.path / (name + '.md')).is_file()]
    for group in ('revisoes', 'relatorios'):
        names.extend(f'{group}/{p.name}' for p in sorted((case.path / group).glob('*.md'))
                     if _DOCUMENT_FILE.fullmatch(p.name) and p.resolve().is_relative_to(case.path.resolve()))
    result = []
    for name in names:
        group, path = _document(case, name)
        result.append(dict(nome=name, grupo=group, bytes=path.stat().st_size, mtime=_mtime(path)))
    return result


def _values(query, name):
    value = query.get(name, [])
    return [value] if isinstance(value, str) else value


def _one(query, name, default=None):
    values = _values(query, name)
    return values[-1] if values else default


def _integer(query, name, default=None, minimum=0):
    value = _one(query, name)
    if value is None:
        return default
    try:
        number = int(value)
    except (ValueError, TypeError):
        raise ValueError(f'{name} deve ser um número inteiro.') from None
    if number < minimum:
        raise ValueError(f'{name} deve ser maior ou igual a {minimum}.')
    return number


def _selected(events, query):
    aliases = {'hash': 'sha256', 'dominio': 'domain'}
    filters = {aliases.get(key, key): _one(query, key) for key in
               ('host', 'user', 'ip', 'hash', 'dominio', 'de', 'ate', 'fonte', 'tipo', 'texto')}
    selected = timeline.filter_events(events, **filters)
    for field in ('host', 'user', 'ip', 'fonte', 'tipo'):
        for value in _values(query, 'excluir_' + field):
            if value:
                excluded = {id(ev) for ev in timeline.filter_events(selected, **{field: value})}
                selected = [ev for ev in selected if id(ev) not in excluded]
    return selected


def _epoch(timestamp):
    return datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp()


def _histogram(events, selected, query):
    span = _epoch(events[-1].ts_utc) - _epoch(events[0].ts_utc) if events else 0
    bucket = _integer(query, 'bucket', max(1, math.ceil(span / 120)), minimum=1)
    coverage = {source: {'primeiro': row['primeiro'], 'ultimo': row['ultimo']}
                for source, row in timeline.coverage(events)['por_fonte'].items()}
    result = dict(bucket_s=bucket, inicio=None, fim=None, n_baldes=0,
                  fontes={}, cobertura=coverage, marcas=[])
    if not selected:
        return result
    start = math.floor(_epoch(selected[0].ts_utc) / bucket) * bucket
    count = math.floor((_epoch(selected[-1].ts_utc) - start) / bucket) + 1
    result.update(inicio=parse_ts(start), fim=parse_ts(start + count * bucket), n_baldes=count)
    for ev in selected:
        values = result['fontes'].setdefault(ev.source, [0] * count)
        values[math.floor((_epoch(ev.ts_utc) - start) / bucket)] += 1
        kinds = []
        if ev.event_type == 'audit' and ev.action in ('1102', '104'):
            kinds.append('log_limpo')
        if ev.extra.get('volume_alto'):
            kinds.append('volume_alto')
        result['marcas'].extend(dict(ts=ev.ts_utc, tipo=kind, raw_ref=ev.raw_ref) for kind in kinds)
    return result


def _summary(case, events):
    data = timeline.coverage(events)
    techniques = []
    for technique, count in data['tecnicas'].items():
        name, tactic = TECHNIQUES.get(technique, ('Técnica não catalogada', 'Não catalogada'))
        techniques.append(dict(id=technique, nome=name, tatica=tactic, eventos=count))
    problems = cases.verify_custody(case)
    return dict(**_metadata(case), total_eventos=len(events), janela=data['janela'],
                por_fonte=data['por_fonte'], por_tipo=data['por_tipo'],
                tecnicas=sorted(techniques, key=lambda t: (t['tatica'], t['id'])),
                hosts_sem_edr=data['hosts_sem_edr'],
                custodia=dict(integra=not problems, arquivos=len(cases.read_custody(case)), problemas=problems),
                contagens=dict(hipoteses=len(parse_hypotheses(_read(case.path / 'hipoteses.md'))),
                               achados=len(parse_findings(_read(case.path / 'achados.md'))),
                               limitacoes=sum(1 for _ in _table_rows(_read(case.path / 'limitacoes.md'))),
                               iocs_registrados=len(_csv(case.iocs_file))))


def dispatch(case_base: Path, route: str, query: dict, *, cache: TimelineCache | None = None):
    """Devolve (status, objeto JSON), sem HTTP ou escrita em disco.

    Query aceita strings ou listas de strings (como ``parse_qs``). O servidor
    fornece seu cache; chamadas sem cache leem diretamente o estado do disco.
    """
    try:
        return _dispatch(Path(case_base), unquote(route), query, cache)
    except FileNotFoundError as exc:
        return 404, {'erro': 'Recurso não encontrado.', 'detalhe': str(exc)}
    except (ValueError, TypeError, csv.Error) as exc:
        return 400, {'erro': 'Requisição inválida.', 'detalhe': str(exc)}
    except Exception as exc:
        return 500, {'erro': 'Erro ao consultar o caso.', 'detalhe': str(exc)}


def _dispatch(base, route, query, cache):
    def events_for(case):
        return cache.events(case) if cache is not None else timeline.build(timeline.load_events(case))

    if route == '/api/formatos':
        return 200, FORMATS
    if route == '/api/casos':
        rows = []
        for path in sorted(base.iterdir()) if base.is_dir() else []:
            if not path.is_dir() or not (path / 'caso.md').is_file():
                continue
            case = cases.get_case(path.name, base)
            if not case.path.resolve().is_relative_to(base.resolve()):
                raise ValueError('Caso fora do diretório de casos.')
            rows.append(dict(**_metadata(case), evidencias=len(cases.read_custody(case)), eventos=len(events_for(case))))
        return 200, rows
    parts = route.split('/')
    if len(parts) < 5 or parts[1:3] != ['api', 'casos']:
        return 404, {'erro': 'Rota não encontrada.'}
    case = cases.get_case(parts[3], base)
    if not case.path.resolve().is_relative_to(base.resolve()):
        raise ValueError('Caso fora do diretório de casos.')
    endpoint = '/'.join(parts[4:])
    if endpoint == 'docs':
        return 200, _documents(case)
    if endpoint.startswith('doc/'):
        name = endpoint[4:]
        group, path = _document(case, name)
        return 200, dict(nome=name, grupo=group, conteudo=_read(path), mtime=_mtime(path), versao=version(path))
    if endpoint == 'hipoteses':
        return 200, parse_hypotheses(_read(case.path / 'hipoteses.md'))
    if endpoint == 'achados':
        return 200, parse_findings(_read(case.path / 'achados.md'))
    if endpoint not in ('resumo', 'eventos', 'histograma', 'entidades', 'iocs', 'grafo'):
        return 404, {'erro': 'Rota não encontrada.'}
    events = events_for(case)
    if endpoint == 'grafo':
        graph = build_graph(events, timeline.coverage(events)['hosts_sem_edr'])
        return 200, relevant_graph(graph) if _one(query, 'relevantes') == '1' else graph
    if endpoint == 'resumo':
        return 200, _summary(case, events)
    if endpoint == 'entidades':
        return 200, timeline.entities(events)
    if endpoint == 'iocs':
        return 200, dict(candidatos=timeline.ioc_candidates(events), registrados=_csv(case.iocs_file))
    selected = _selected(events, query)
    limit = _integer(query, 'limite')
    if endpoint == 'histograma':
        return 200, _histogram(events, selected, query)
    indices = {id(ev): idx for idx, ev in enumerate(events)}
    return 200, dict(total=len(events), filtrados=len(selected),
                     eventos=[dict(idx=indices[id(ev)], **ev.to_dict()) for ev in selected[:limit]])
