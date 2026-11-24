from pathlib import Path
from typing import Iterator

from perito.schema import Event, normalize_user, to_int
from ._io import event, get, iter_events, structured


def map_record(rec, ref, source='entra_signin'):
    status = structured(get(rec, 'status'), {})
    location = structured(get(rec, 'location', 'LocationDetails'), {})
    device = structured(get(rec, 'deviceDetail'), {})
    code = to_int(get(status, 'errorCode', default=get(rec, 'ResultType')))
    user = get(rec, 'userPrincipalName')
    app = get(rec, 'appDisplayName')
    ip = get(rec, 'ipAddress')
    outcome = 'success' if code == 0 else 'failure'
    extra = dict(upn=user, error_code=code, failure_reason=get(status, 'failureReason', default=get(rec, 'ResultDescription')), city=get(location, 'city'), country=get(location, 'countryOrRegion'), risk_level=get(rec, 'riskLevelDuringSignIn'), user_agent=get(rec, 'userAgent'), client_app=get(rec, 'clientAppUsed'), ca_status=get(rec, 'conditionalAccessStatus'), auth_requirement=get(rec, 'authenticationRequirement'), signin_id=get(rec, 'id'))
    return event(rec, ref, source, get(rec, 'createdDateTime', 'TimeGenerated'), event_type='signin', user=user, src_ip=ip, host=get(device, 'displayName'), action=app, outcome=outcome, extra=extra, description=f'Sign-in {"SUCESSO" if code == 0 else "FALHOU"} ({code}) de {normalize_user(user)} em {app} a partir de {ip} ({extra["city"]}/{extra["country"]})')


def parse(path: Path) -> Iterator[Event]:
    yield from iter_events(path, map_record, 'entra_signin')
