"""Registro de parsers e entrada com estatísticas de registros ignorados."""
from pathlib import Path
from typing import Iterator

from perito.schema import Event
from . import defender, sentinel, entra_signin, entra_audit, splunk, elastic, wazuh
from ._io import iter_events

_MODULES = {module.__name__.rsplit('.', 1)[-1]: module for module in (defender, sentinel, entra_signin, entra_audit, splunk, elastic, wazuh)}
PARSERS = {name: module.parse for name, module in _MODULES.items()}


def parse_file(path: Path, fonte: str, stats: dict | None = None) -> Iterator[Event]:
    if fonte not in PARSERS:
        raise ValueError(f'Fonte desconhecida: {fonte}')
    yield from iter_events(path, _MODULES[fonte].map_record, fonte, stats)
