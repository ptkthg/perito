from pathlib import Path
from typing import Iterator

from perito.schema import Event, normalize_user
from ._io import event, get, iter_events, structured


def map_record(rec, ref, source='entra_audit'):
    initiator = structured(get(rec, 'initiatedBy'), {})
    targets = structured(get(rec, 'targetResources'), [])
    if isinstance(targets, dict):
        targets = [targets]
    details = structured(get(rec, 'additionalDetails'), [])
    details = details if isinstance(details, dict) else {get(d, 'key'): get(d, 'value') for d in details}
    user = get(initiator, 'user.userPrincipalName')
    app = get(initiator, 'app.displayName')
    names = [get(t, 'userPrincipalName', 'displayName') for t in targets]
    names = [n for n in names if n]
    action = get(rec, 'activityDisplayName', 'OperationName')
    extra = dict(category=get(rec, 'category'), logged_by_service=get(rec, 'loggedByService'), targets=names, details=details)
    # modifiedProperties pode conter StrongAuthentication para Update user.
    extra['modified_properties'] = [p for t in targets for p in get(t, 'modifiedProperties', default=[])]
    if app:
        extra['initiated_by_app'] = app
    return event(rec, ref, source, get(rec, 'activityDateTime', 'TimeGenerated'), event_type='audit', user=user, src_ip=get(initiator, 'user.ipAddress'), action=action, outcome=str(get(rec, 'result', default='')).lower() or None, extra=extra, description=f'{action} por {normalize_user(user) or app or "origem desconhecida"} → {", ".join(names)}')


def parse(path: Path) -> Iterator[Event]:
    yield from iter_events(path, map_record, 'entra_audit')
