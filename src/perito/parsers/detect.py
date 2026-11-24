"""Detecção por conteúdo, sem depender do nome do export."""
import csv
from pathlib import Path

from ._io import records


def detect_source(path: Path) -> str | None:
    if Path(path).suffix.lower() not in ('.csv', '.json', '.ndjson', '.jsonl', '.log'):
        return None
    if Path(path).suffix.lower() == '.csv':
        with Path(path).open(encoding='utf-8-sig', newline='') as fh:
            keys = csv.DictReader(fh).fieldnames or []
        rows = [({key: True for key in keys}, '')]
    else:
        rows = records(path, keep_hits=True)
    for index, (rec, _) in enumerate(rows):
        keys = {key.lower() for key in rec}
        if {'rule', 'agent'} <= keys:
            return 'wazuh'
        if {'@timestamp', 'hits'} & keys:
            return 'elastic'
        if '_time' in keys:
            return 'splunk'
        if {'activitydisplayname', 'activitydatetime'} & keys:
            return 'entra_audit'
        if {'createddatetime', 'userprincipalname'} <= keys:
            return 'entra_signin'
        if 'timegenerated' in keys:
            return 'sentinel'
        if 'timestamp' in keys and {'devicename', 'actiontype', 'senderfromaddress'} & keys:
            return 'defender'
        if index >= 9:
            break
    return None
