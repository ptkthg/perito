"""Classificação de IP para investigação, incluindo endereços sintéticos."""
import ipaddress

from .schema import is_private_ip

_DOCUMENTATION = tuple(ipaddress.ip_network(n) for n in ('192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24', '2001:db8::/32'))


def is_external_ip(value: str | None) -> bool:
    if not value:
        return False
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    # TEST-NET representa destinos externos nos casos sintéticos; não é RFC1918.
    return any(ip in network for network in _DOCUMENTATION) or (not is_private_ip(value) and ip.is_global)
