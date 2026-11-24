"""Gera fixtures JSON (contrato da spec 04) a partir de um caso, para desenvolver o frontend sem o servidor.

Uso: uv run python scripts/gerar_fixtures_ui.py TESTE-001
Saída: ui/public/fixtures/<ID>/{casos,resumo,eventos,histograma,entidades,iocs}.json
Somente para casos SINTÉTICOS: não gere fixtures de casos reais (o diretório ui/ é versionado).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from perito import timeline
from perito.case import get_case, read_custody, verify_custody
from perito.mitre import TECHNIQUES

ROOT = Path(__file__).resolve().parents[1]


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def main(case_id: str) -> None:
    case = get_case(case_id)
    events = timeline.build(timeline.load_events(case))
    cov = timeline.coverage(events)
    out = ROOT / "ui" / "public" / "fixtures" / case_id
    out.mkdir(parents=True, exist_ok=True)

    eventos = [dict(ev.to_dict(), idx=i) for i, ev in enumerate(events)]
    tecnicas = sorted(
        ({"id": t, "nome": TECHNIQUES.get(t, (t, "?"))[0], "tatica": TECHNIQUES.get(t, ("", "Outras"))[1], "eventos": n}
         for t, n in cov["tecnicas"].items()),
        key=lambda x: (x["tatica"], x["id"]),
    )
    problemas = verify_custody(case)
    resumo = {
        "id": case_id, "titulo": "Caso sintético: phishing Financeiro", "fase": "Detectar / Identification",
        "total_eventos": len(events), "janela": cov["janela"], "por_fonte": cov["por_fonte"], "por_tipo": cov["por_tipo"],
        "tecnicas": tecnicas, "hosts_sem_edr": cov.get("hosts_sem_edr", []),
        "custodia": {"integra": not problemas, "arquivos": len(read_custody(case)), "problemas": problemas},
        "contagens": {"hipoteses": 3, "achados": 14, "limitacoes": 3, "iocs_registrados": 0},
    }

    bucket = 60
    first, last = _parse(events[0].ts_utc), _parse(events[-1].ts_utc)
    start = datetime.fromtimestamp((int(first.timestamp()) // bucket) * bucket, tz=timezone.utc)
    n = int((last - start).total_seconds() // bucket) + 1
    fontes: dict[str, list[int]] = {}
    marcas = []
    for ev in events:
        i = int((_parse(ev.ts_utc) - start).total_seconds() // bucket)
        fontes.setdefault(ev.source, [0] * n)[i] += 1
        if ev.event_type == "audit" and ev.action in ("1102", "104"):
            marcas.append({"ts": ev.ts_utc, "tipo": "log_limpo", "raw_ref": ev.raw_ref})
        if ev.extra.get("volume_alto"):
            marcas.append({"ts": ev.ts_utc, "tipo": "volume_alto", "raw_ref": ev.raw_ref})
    histograma = {
        "bucket_s": bucket, "inicio": _ts(start), "fim": events[-1].ts_utc, "n_baldes": n, "fontes": fontes,
        "cobertura": {f: {"primeiro": v["primeiro"], "ultimo": v["ultimo"]} for f, v in cov["por_fonte"].items()},
        "marcas": marcas,
    }

    files = {
        "casos.json": [{"id": case_id, "titulo": resumo["titulo"], "fase": resumo["fase"], "evidencias": resumo["custodia"]["arquivos"], "eventos": len(events)}],
        "resumo.json": resumo,
        "eventos.json": {"total": len(events), "filtrados": len(events), "eventos": eventos},
        "histograma.json": histograma,
        "entidades.json": timeline.entities(events),
        "iocs.json": {"candidatos": timeline.ioc_candidates(events), "registrados": []},
    }
    for name, data in files.items():
        (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"fixtures em {out} ({len(events)} eventos, {n} baldes)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "TESTE-001")
