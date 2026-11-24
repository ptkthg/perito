"""Escritas confinadas da bancada, independentes do transporte HTTP."""
from __future__ import annotations

import csv
import io
import json
import re
from contextlib import nullcontext
from threading import Lock

from .. import case as cases
from .. import timeline
from .._atomic import atomic_open, version
from .api import _REF, _csv, _plain, _table_rows, parse_hypotheses

_LOCKS = {}
_LOCKS_GUARD = Lock()
_ROUTE = re.compile(r'/api/casos/([^/]+)/(ingestao|achados|hipoteses(?:/H\d+)?|iocs|limitacoes)\Z')
_LABELS = {'status': 'Status', 'confianca': 'Confiança', 'fase': 'Fase ATT&CK',
           'sustentacao': 'Sustentação ([EVIDÊNCIA] com raw_ref)', 'confirmaria': 'Confirmaria',
           'refutaria': 'Refutaria', 'proximo_passo': 'Próximo passo',
           'contradiz': 'Contradiz', 'justificativa': 'Justificativa'}


def case_lock(case):
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(case.path.resolve(), Lock())


def route_lock(base, route):
    parts = route.split('/')
    if len(parts) >= 5 and parts[1:3] == ['api', 'casos']:
        return case_lock(get_case(base, parts[3]))
    return nullcontext()


def get_case(base, case_id):
    case = cases.get_case(case_id, base)
    if not case.path.resolve().is_relative_to(base.resolve()):
        raise ValueError('Caso fora do diretório de casos.')
    return case


def confined(case, name):
    path = case.path / name
    if path.is_symlink() or path.resolve() != case.path.resolve() / name:
        raise ValueError('Destino fora do diretório permitido.')
    return path


def read_target(base, route):
    parts = route.split('/')
    if len(parts) < 5 or parts[1:3] != ['api', 'casos']:
        return None
    case = get_case(base, parts[3])
    endpoint = '/'.join(parts[4:])
    if endpoint in ('achados', 'hipoteses', 'iocs'):
        return confined(case, 'iocs.csv' if endpoint == 'iocs' else endpoint + '.md')
    if endpoint.startswith('doc/'):
        from .api import _document
        return _document(case, endpoint[4:])[1]
    return None


def write_route(method, route):
    match = _ROUTE.fullmatch(route)
    if not match:
        return None
    case_id, endpoint = match.groups()
    allowed = ('PATCH',) if endpoint.startswith('hipoteses/') else ('POST', 'PATCH') if endpoint == 'iocs' else ('POST',)
    return (case_id, endpoint) if method in allowed else None


def audit(case, action, target, summary, before, after):
    path = confined(case, 'auditoria-ui.log')
    entry = dict(ts=cases.now_utc(), acao=action, alvo=target, resumo=summary,
                 versao_antes=before, versao_depois=after)
    with path.open('a', encoding='utf-8', newline='') as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + '\n')


def _text(data, key, minimum=0, maximum=None, default=''):
    value = data.get(key, default)
    if not isinstance(value, str) or len(value.strip()) < minimum or (maximum is not None and len(value) > maximum):
        raise ValueError(f'{key} inválido.')
    return value


def _confidence(data):
    value = _text(data, 'confianca')
    value = 'média' if value == 'media' else value
    if value not in ('baixa', 'média', 'alta'):
        raise ValueError('Confiança inválida.')
    return value


def _line(value):
    return value.replace('\r', ' ').replace('\n', ' ')


def _append_table(text, header, row):
    has_table = any(re.match(r'^\|\s*#\s*\|', line) and
                    len(re.split(r'(?<!\\)\|', line.strip().strip('|'))) == len(row)
                    for line in text.splitlines())
    if not has_table:
        text = text.rstrip('\r\n') + '\n\n' + header + '\n|' + '|'.join('---' for _ in row) + '|\n'
    return text + ('' if text.endswith('\n') else '\n') + '| ' + ' | '.join(timeline.md_cell(v) for v in row) + ' |\n'


def _finding(case, text, data, cache):
    idx = data.get('idx')
    if type(idx) is not int or idx < 0:
        raise ValueError('idx inválido.')
    finding = _text(data, 'achado', 3, 300)
    attack = data.get('attack')
    if not isinstance(attack, list) or any(not isinstance(t, str) or not re.fullmatch(r'T\d{4}(?:\.\d{3})?', t, re.ASCII) for t in attack):
        raise ValueError('ATT&CK inválido.')
    events = cache.events(case) if cache is not None else timeline.build(timeline.load_events(case))
    if idx >= len(events):
        raise FileNotFoundError('Evento não encontrado.')
    ev = events[idx]
    number = max((int(c[0].lstrip('A')) for _, c in _table_rows(text) if re.fullmatch(r'A?\d+', c[0])), default=0) + 1
    name = f'A{number}'
    refs = '; '.join([ev.raw_ref, *ev.extra.get('corroborado_por', [])])
    row = [name, ev.ts_utc, ev.host or ('~' + ev.extra['src_host'] if ev.extra.get('src_host') else '—'),
           ev.user or '—', finding, ', '.join(attack), refs]
    return _append_table(text, '| # | UTC | Host | Conta | Achado | ATT&CK | Evidência |', row), {'id': name}


def _hypothesis(text, data, hypothesis_id=None):
    # Substituições locais preservam BOM, CRLF e o restante do documento.
    headings = list(re.finditer(r'^##[ \t]+(H\d+):[^\r\n]*', text, re.M))
    newline = '\r\n' if '\r\n' in text else '\n'
    if hypothesis_id is None:
        title = _line(_text(data, 'titulo', 1))
        confidence = _confidence(data)
        placeholder = headings[0] if len(headings) == 1 and re.fullmatch(r'##\s+H1:\s*<título>\s*', headings[0][0]) else None
        number = 1 if placeholder else max((int(m[1][1:]) for m in headings), default=0) + 1
        fields = dict(status='aberta', confianca=confidence)
        fields.update({key: _line(_text(data, key)) for key in ('fase', 'sustentacao', 'confirmaria', 'refutaria', 'proximo_passo')})
        section = f'## H{number}: {title}' + newline + ''.join(f'- **{_LABELS[k]}:** {v}{newline}' for k, v in fields.items())
        if placeholder:
            # O placeholder é a única hipótese; preserva outras seções do documento.
            end = re.search(r'^## ', text[placeholder.end():], re.M)
            stop = placeholder.end() + end.start() if end else len(text)
            updated = text[:placeholder.start()] + section + text[stop:]
        else:
            updated = text + ('' if text.endswith('\n') else newline) + newline + section
        return updated, {'id': f'H{number}'}
    match = next((m for m in headings if m[1] == hypothesis_id), None)
    if match is None:
        raise FileNotFoundError('Hipótese não encontrada.')
    next_heading = re.search(r'^## ', text[match.end():], re.M)
    end = match.end() + next_heading.start() if next_heading else len(text)
    section = text[match.start():end]
    updates = {}
    if 'status' in data:
        if data['status'] not in ('aberta', 'confirmada', 'refutada', 'inconclusiva'):
            raise ValueError('Status inválido.')
        updates['status'] = data['status']
    if 'confianca' in data:
        updates['confianca'] = _confidence(data)
    if 'proximo_passo' in data:
        updates['proximo_passo'] = _line(_text(data, 'proximo_passo'))
    hypotheses = parse_hypotheses(section)
    if not hypotheses:
        raise FileNotFoundError('Hipótese não encontrada.')
    parsed = hypotheses[0]
    ref_appends = {}
    refs = data.get('refs_add', [])
    if not isinstance(refs, list):
        raise ValueError('refs_add deve ser uma lista.')
    for item in refs:
        if not isinstance(item, dict) or item.get('relacao') not in ('apoia', 'contradiz'):
            raise ValueError('Relação inválida.')
        ref = _text(item, 'ref', 1)
        if not re.fullmatch(r'(?:A\d+|[^\r\n|]+\.[A-Za-z0-9]+[:#]\d+(?:-\d+)?)', ref):
            raise ValueError('Referência inválida.')
        key = 'sustentacao' if item['relacao'] == 'apoia' else 'contradiz'
        current = updates.get(key, parsed.get(key) or '')
        if not re.search(r'(?<![\w.-])' + re.escape(ref) + r'(?![\w.-])', current):
            updates[key] = current + ' [EVIDÊNCIA] ' + ref
            ref_appends.setdefault(key, []).append(' [EVIDÊNCIA] ' + ref)
    if data.get('status') in ('confirmada', 'refutada'):
        _text(data, 'justificativa', 1)
        if data['status'] == 'confirmada' and not _REF.search(updates.get('sustentacao', parsed.get('sustentacao') or '')):
            raise ValueError('Confirmação exige referência em Sustentação.')
    if 'justificativa' in data:
        updates['justificativa'] = cases.now_utc() + ' ' + _line(_text(data, 'justificativa', 1))
    for key, value in updates.items():
        # Localiza o bullet pelo rótulo normalizado, sem reformatação de outras linhas.
        found = None
        for bullet in re.finditer(r'^[ \t]*-[ \t]+\*\*([^\r\n]+?):\*\*[^\S\r\n]*([^\r\n]*)', section, re.M):
            label = _plain(bullet[1]).split(' (', 1)[0].strip()
            expected = _plain(_LABELS[key]).split(' (', 1)[0]
            if label == expected:
                found = bullet
                break
        if found:
            value_end = found.end(2)
            # Inclui só as continuações deste bullet; não duplica nem reformata.
            while True:
                continuation = re.match(r'\r?\n([ \t]+[^\r\n]+)', section[value_end:])
                if not continuation or continuation[1].lstrip().startswith('- **'):
                    break
                value_end += continuation.end()
            if key in ref_appends:
                value = section[found.start(2):value_end] + ''.join(ref_appends[key])
            section = section[:found.start(2)] + value + section[value_end:]
        else:
            section += ('' if section.endswith('\n') else newline) + f'- **{_LABELS[key]}:** {value}{newline}'
    return text[:match.start()] + section + text[end:], {'id': hypothesis_id}


def _ioc_key(data):
    if data.get('tipo') not in ('ip', 'dominio', 'sha256', 'arquivo', 'email', 'url'):
        raise ValueError('Tipo de IOC inválido.')
    return data['tipo'], _text(data, 'valor', 1)


def _iocs(path, data, method):
    rows = _csv(path)
    if method == 'POST':
        key = _ioc_key(data)
        if any((r['tipo'], r['valor']) == key for r in rows):
            return None, {'existente': True}
        row = {field: _text(data, field) for field in cases.IOC_HEADER}
        row['confianca'] = data.get('confianca', 'candidato')
        if row['confianca'] not in ('candidato', 'confirmado', 'descartado'):
            raise ValueError('Confiança de IOC inválida.')
        rows.append(row)
    else:
        items = data.get('itens', [data])
        if not isinstance(items, list) or not items:
            raise ValueError('Lote inválido.')
        for item in items:
            if not isinstance(item, dict):
                raise ValueError('IOC inválido.')
            key = _ioc_key(item)
            confidence = item.get('confianca')
            if confidence not in ('candidato', 'confirmado', 'descartado'):
                raise ValueError('Confiança de IOC inválida.')
            reason = ''
            if confidence == 'descartado':
                reason = _text(item, 'motivo', 1)
                if reason not in ('falso positivo', 'infraestrutura legítima', 'interno') and not (reason.startswith('outro: ') and 1 <= len(reason[7:].strip()) <= 200):
                    raise ValueError('Motivo inválido.')
            row = next((r for r in rows if (r['tipo'], r['valor']) == key), None)
            if row is None:
                raise FileNotFoundError('IOC não encontrado.')
            row['confianca'] = confidence
            if reason:
                row['contexto'] += ' · descartado: ' + reason
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=cases.IOC_HEADER)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue(), {}


def write_json(case, endpoint, method, data, cache):
    """Chamado sob o lock do caso, incluindo comparação, gravação e auditoria."""
    if not isinstance(data, dict):
        raise ValueError('O corpo deve ser um objeto JSON.')
    name = endpoint.split('/')[0]
    path = confined(case, 'iocs.csv' if name == 'iocs' else name + '.md')
    confined(case, 'auditoria-ui.log')
    before = version(path)
    text = path.read_bytes().decode('utf-8') if path.is_file() else ''
    if not isinstance(data.get('versao'), str):
        raise ValueError('versao é obrigatória.')
    if data['versao'] != before:
        return 409, dict(erro='conflito', versao_atual=before, conteudo_atual=text)
    if name == 'achados':
        content, extra = _finding(case, text, data, cache)
    elif name == 'hipoteses':
        content, extra = _hypothesis(text, data, endpoint.split('/')[1] if '/' in endpoint else None)
    elif name == 'iocs':
        content, extra = _iocs(path, data, method)
    else:
        number = max((int(c[0].lstrip('L')) for _, c in _table_rows(text) if re.fullmatch(r'L?\d+', c[0])), default=0) + 1
        extra = {'id': f'L{number}'}
        row = [extra['id'], *(_text(data, key, 3, 400) for key in ('limitacao', 'impacto', 'mitigacao'))]
        content = _append_table(text, '| # | Limitação | Impacto na conclusão | Como mitigar |', row)
    if content is not None:
        with atomic_open(path) as fh:
            fh.write(content)
    summary = 'IOC já registrado' if extra.get('existente') else extra.get('id', 'IOCs atualizados')
    audit(case, method + ' ' + endpoint, path.name, summary, before, version(path))
    return 200, dict(ok=True, versao=version(path), **extra)
