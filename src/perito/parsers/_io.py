"""Leitura compartilhada, referências físicas e isolamento de registros inválidos."""
from __future__ import annotations

import csv
import json
import logging
from pathlib import Path

from perito.schema import Event, normalize_host, normalize_ip, normalize_process, normalize_user, parse_ts

LOGGER = logging.getLogger('perito.parsers')


def clean(value):
    return None if isinstance(value, str) and value.strip().lower() in ('', '-', 'null', 'n/a', 'none') else value


def get(rec, *keys, default=None):
    """Lookup ECS pontuado/aninhado e aliases sem distinção de caixa."""
    for key in keys:
        current = rec
        if isinstance(current, dict):
            direct = next((v for k, v in current.items() if k.lower() == key.lower()), None)
            if clean(direct) is not None:
                return clean(direct)
        for part in key.split('.'):
            if not isinstance(current, dict):
                current = None
                break
            current = next((v for k, v in current.items() if k.lower() == part.lower()), None)
        if clean(current) is not None:
            return clean(current)
    return default


def structured(value, default=None):
    if isinstance(value, str):
        return json.loads(value)
    return value if value is not None else default


def techniques(value):
    if not value:
        return []
    if isinstance(value, str):
        value = json.loads(value) if value.strip().startswith('[') else value.replace(';', ',').split(',')
    return sorted({str(v).strip() for v in value if str(v).strip()})


def rejected(ref, error, stats):
    LOGGER.warning('%s: registro ignorado: %s', ref, error)
    if stats is not None:
        stats['ignorados'] = stats.get('ignorados', 0) + 1


def unwrap(rec):
    if not isinstance(rec, dict):
        raise ValueError('registro não é um objeto JSON')
    for key in ('result', '_source'):
        if isinstance(rec.get(key), dict):
            return rec[key]
    return rec


def records(path: Path, stats=None, *, keep_hits=False):
    path = Path(path)
    if path.suffix.lower() == '.csv':
        with path.open(encoding='utf-8-sig', newline='') as fh:
            reader = csv.reader(fh)
            headers = next(reader, [])
            while True:
                line = reader.line_num + 1
                try:
                    values = next(reader)
                except StopIteration:
                    break
                if not values:
                    continue
                rec = {key: values[index] if index < len(values) else None for index, key in enumerate(headers)}
                yield rec, f'{path.name}:{line}'
        return
    text = path.read_text(encoding='utf-8-sig')
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = None
    if isinstance(data, dict) and 'value' in data:
        data = data['value']
    elif not keep_hits and isinstance(data, dict) and isinstance(data.get('hits'), dict):
        data = data['hits'].get('hits', [])
    if isinstance(data, list):
        for index, rec in enumerate(data):
            ref = f'{path.name}#{index}'
            try:
                row = unwrap(rec)
            except ValueError as exc:
                rejected(ref, exc, stats)
                continue
            yield row, ref
    elif data is not None:
        ref = f'{path.name}:1'
        try:
            rec = unwrap(data)
        except ValueError as exc:
            rejected(ref, exc, stats)
        else:
            yield rec, ref
    else:
        for line, content in enumerate(text.splitlines(), 1):
            if not content.strip():
                continue
            ref = f'{path.name}:{line}'
            try:
                rec = unwrap(json.loads(content))
            except (ValueError, TypeError) as exc:
                rejected(ref, exc, stats)
                continue
            yield rec, ref


def event(rec, ref, source, timestamp, **fields):
    extra = fields.pop('extra', {})
    original = fields.get('user')
    if original is not None:
        extra['user_original'] = original
    for field, normalize in (('host', normalize_host), ('user', normalize_user), ('process', normalize_process), ('parent', normalize_process), ('src_ip', normalize_ip), ('dst_ip', normalize_ip)):
        if field in fields:
            fields[field] = normalize(clean(fields[field]))
    for key, value in fields.items():
        fields[key] = clean(value)
    if fields.get('sha256'):
        fields['sha256'] = str(fields['sha256']).lower()
    ev = Event(ts_utc=parse_ts(timestamp), ts_original=str(timestamp), source=source, raw_ref=ref, extra=extra, **fields)
    # parse_ts assume UTC para horários sem offset; torne a lacuna explícita.
    import re
    if isinstance(timestamp, str) and not re.search(r'(Z|[+-]\d{2}:?\d{2})$', timestamp, re.I) and not timestamp.replace('.', '', 1).isdigit():
        ev.extra['limitacao_fuso'] = '[LIMITAÇÃO] Fuso ausente na fonte; UTC assumido.'
    if not ev.description:
        if ev.event_type == 'process':
            ev.description = f'{ev.process or "Processo"} iniciado por {ev.parent or "processo desconhecido"}'
        elif ev.event_type in ('network', 'dns'):
            ev.description = f'{"Consulta DNS" if ev.event_type == "dns" else "Conexão"}: {ev.src_ip or ev.host or "origem desconhecida"} → {ev.domain or ev.dst_ip or "destino desconhecido"}'
        elif ev.event_type == 'file':
            ev.description = f'Arquivo {ev.action or "alterado"}: {ev.file_path or "caminho desconhecido"} (por {ev.process or "processo desconhecido"})'
        elif ev.event_type == 'scheduled_task':
            ev.description = f'Tarefa agendada {ev.action or ""}: {ev.extra.get("task_name") or "nome desconhecido"} → {ev.extra.get("task_content") or "?"} (por {ev.process or "?"})'
        elif ev.event_type == 'registry':
            ev.description = f'Registro {ev.action or "alterado"}: {ev.extra.get("registry_key") or "?"} (por {ev.process or "?"})'
        else:
            ev.description = f'{ev.event_type}: {ev.action or "evento"} — {ev.user or ev.process or "sem conta/processo"}'
    ev.description = ' '.join(ev.description.splitlines())
    return ev


def iter_events(path, mapper, source, stats=None):
    if stats is not None:
        stats.setdefault('ignorados', 0)
    for rec, ref in records(path, stats):
        try:
            ev = mapper(rec, ref, source)
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError) as exc:
            rejected(ref, exc, stats)
            continue
        yield ev
