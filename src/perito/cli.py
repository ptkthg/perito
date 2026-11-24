"""Interface de linha de comando do Perito, sem dependências de runtime."""
from __future__ import annotations

import argparse
import csv
import sys
import traceback
from pathlib import Path

from . import case as cases
from . import timeline
from ._network import is_external_ip
from .mitre import TECHNIQUES, annotate
from .parsers import PARSERS, parse_file
from .parsers.detect import detect_source


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError(f'Argumentos inválidos: {message}')


def _nonnegative(value):
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError('Informe um número inteiro.') from None
    if number < 0:
        raise argparse.ArgumentTypeError('O limite deve ser maior ou igual a zero.')
    return number


def _parser():
    parser = Parser(prog='perito', description='Normalização e investigação de evidências DFIR')
    parser.add_argument('--casos', type=Path, default=cases.CASES_DIR, help='Pasta dos casos')
    parser.add_argument('--debug', action='store_true', help='Exibe traceback em erros')
    commands = parser.add_subparsers(dest='command', required=True)
    ui = commands.add_parser('ui', help='Abre a interface local de consulta')
    ui.add_argument('--porta', type=int, default=8765)
    ui.add_argument('--caso')
    ui.add_argument('--sem-navegador', action='store_true')
    ui.add_argument('--token')
    commands.add_parser('casos', help='Lista os casos')
    new = commands.add_parser('novo-caso', help='Cria a estrutura de um caso')
    new.add_argument('id')
    new.add_argument('--titulo', default='')
    new.add_argument('--responsavel')
    for command in ('evidencia', 'ingerir'):
        sub = commands.add_parser(command)
        sub.add_argument('id')
        sub.add_argument('caminhos', nargs='+', type=Path)
        sub.add_argument('--fonte', default='auto' if command == 'ingerir' else '', choices=['auto', *PARSERS] if command == 'ingerir' else None)
        sub.add_argument('--obs', default='')
    view = commands.add_parser('timeline')
    view.add_argument('id')
    for option in ('host', 'user', 'ip', 'hash', 'dominio', 'de', 'ate', 'fonte', 'tipo', 'texto'):
        view.add_argument('--' + option)
    view.add_argument('--formato', choices=('md', 'csv', 'jsonl'), default='md')
    view.add_argument('--limite', type=_nonnegative)
    view.add_argument('--saida', type=Path)
    pivot = commands.add_parser('pivo')
    pivot.add_argument('id')
    group = pivot.add_mutually_exclusive_group(required=True)
    for option in ('host', 'user', 'ip', 'hash', 'dominio'):
        group.add_argument('--' + option)
    iocs = commands.add_parser('iocs')
    iocs.add_argument('id')
    iocs.add_argument('--gravar', action='store_true')
    for command in ('resumo', 'verificar'):
        sub = commands.add_parser(command)
        sub.add_argument('id')
    return parser


def _table(headers, rows):
    lines = ['| ' + ' | '.join(headers) + ' |', '|' + '|'.join('---' for _ in headers) + '|']
    for row in rows:
        lines.append('| ' + ' | '.join(timeline.md_cell(value) if value != 0 else '0' for value in row) + ' |')
    return '\n'.join(lines) + '\n'


def _paths(paths):
    for path in paths:
        if path.is_dir():
            yield from sorted(p for p in path.rglob('*') if p.is_file() and p.suffix.lower() in ('.csv', '.json', '.ndjson', '.jsonl', '.log'))
        elif path.is_file():
            yield path
        else:
            raise FileNotFoundError(f'Arquivo ou pasta não encontrado: {path}')


def _full_timeline(case):
    events = timeline.build(timeline.load_events(case))
    timeline.write_outputs(case, events)
    return events


def _ingest(case, args):
    rows = []
    # Materialize antes de escrever para não enumerar arquivos recém-gerados.
    for path in list(_paths(args.caminhos)):
        raw = cases.add_evidence(case, path, fonte=args.fonte, observacao=args.obs)
        source = detect_source(raw) if args.fonte == 'auto' else args.fonte
        stats = {}
        count = 0
        if source:
            normalized = case.normalized_dir / f'{source}__{raw.stem}.jsonl'
            with normalized.open('w', encoding='utf-8', newline='\n') as fh:
                for ev in parse_file(raw, source, stats):
                    fh.write(annotate(ev).to_json() + '\n')
                    count += 1
        else:
            print(f'Aviso: fonte não detectada em {raw.name}; evidência registrada, sem normalização.', file=sys.stderr)
        digest = next(r['sha256'] for r in cases.read_custody(case) if r['arquivo'] == raw.name)
        rows.append((raw.name, source or 'desconhecida', count, stats.get('ignorados', 0), digest[:12]))
    _full_timeline(case)
    print(_table(['Arquivo', 'Fonte', 'Eventos', 'Ignorados', 'SHA-256'], rows), end='')
    return 0


def _filters(args):
    aliases = {'hash': 'sha256', 'dominio': 'domain'}
    return {aliases.get(k, k): getattr(args, k) for k in ('host', 'user', 'ip', 'hash', 'dominio', 'de', 'ate', 'fonte', 'tipo', 'texto') if getattr(args, k, None) is not None}


def _protect_raw_output(destination, base):
    """Nem --saida pode sobrescrever uma evidência custodiada."""
    target = destination.resolve()
    for directory in base.glob('*/evidencias/brutas'):
        if target.is_relative_to(directory.resolve()):
            raise ValueError('A saída não pode gravar em evidencias/brutas: evidência bruta é imutável.')


def _view(case, args):
    events = _full_timeline(case)
    selected = timeline.filter_events(events, **_filters(args))
    if args.limite is not None:
        selected = selected[:args.limite]
    content = timeline.render_md(selected) if args.formato == 'md' else timeline.render_csv(selected) if args.formato == 'csv' else ''.join(ev.to_json() + '\n' for ev in selected)
    if args.saida:
        _protect_raw_output(args.saida, args.casos)
        args.saida.write_text(content, encoding='utf-8', newline='')
    else:
        print(content, end='')
    return 0


def _entity_tables(events, top=None, public_only=False):
    data = timeline.entities(events)
    rows = []
    kinds = ('host', 'user', 'ip') if top is not None else ('host', 'user', 'ip', 'domain', 'sha256')
    for kind in kinds:
        values = sorted(data[kind].items(), key=lambda item: (-item[1]['eventos'], item[0]))
        if kind == 'ip' and public_only:
            values = [(value, stats) for value, stats in values if is_external_ip(value)]
        for value, stats in values[:top] if top is not None else values:
            rows.append((kind, value, stats['eventos'], stats['primeira'], stats['ultima']))
    return _table(['Tipo', 'Entidade', 'Eventos', 'Primeira vez (UTC)', 'Última vez (UTC)'], rows)


def _ioc_output(case, events, save):
    rows = timeline.ioc_candidates(events)
    print('[LIMITAÇÃO] IOCs candidatos, sujeitos à validação do analista. Referências na timeline do caso.\n')
    print(_table(cases.IOC_HEADER, ([r[h] for h in cases.IOC_HEADER] for r in rows)), end='')
    if save:
        with case.iocs_file.open(encoding='utf-8', newline='') as fh:
            existing = {(r['tipo'], r['valor']) for r in csv.DictReader(fh)}
        with case.iocs_file.open('a', encoding='utf-8', newline='') as fh:
            writer = csv.DictWriter(fh, fieldnames=cases.IOC_HEADER)
            writer.writerows(r for r in rows if (r['tipo'], r['valor']) not in existing)
    return 0


def _verify(case):
    problems = cases.verify_custody(case)
    if problems:
        print('[LIMITAÇÃO] Problemas de integridade na custódia:')
        print(_table(['Arquivo', 'Problema'], problems), end='')
    else:
        print('[EVIDÊNCIA] Custódia íntegra: hashes recalculados e conferidos com custodia.csv.')
    return 2 if problems else 0


def _summary(case, events):
    data = timeline.coverage(events)
    print(f'# Resumo: {case.case_id}\n')
    print(f'[EVIDÊNCIA] Janela: {data["janela"]["primeiro"]} → {data["janela"]["ultimo"]}. Fonte: timeline/timeline.jsonl (raw_ref por evento).\n')
    print(_table(['Fonte', 'Eventos', 'Primeiro (UTC)', 'Último (UTC)'], ((source, d['eventos'], d['primeiro'], d['ultimo']) for source, d in sorted(data['por_fonte'].items()))))
    print(_table(['Tipo', 'Eventos'], sorted(data['por_tipo'].items())))
    print('[LIMITAÇÃO] Técnicas ATT&CK são sugestões automáticas ou fornecidas pela fonte; requerem confirmação.\n')
    techniques = []
    for technique, count in data['tecnicas'].items():
        name, tactic = TECHNIQUES.get(technique, ('Técnica não catalogada', 'Não catalogada'))
        techniques.append((tactic, technique, name, count))
    print(_table(['Tática', 'ATT&CK', 'Nome', 'Eventos'], sorted(techniques)))
    print('## Entidades principais\n')
    print(_entity_tables(events, top=10, public_only=True))
    for host in data['hosts_sem_edr']:
        print(f'[LIMITAÇÃO] Possível ausência de EDR em {host}: nenhum evento Defender ou process Elastic no material normalizado.\n')
    _verify(case)
    return 0


def _list_cases(base):
    rows = []
    for path in sorted(base.iterdir()) if base.exists() else []:
        metadata = path / 'caso.md'
        if path.is_dir() and metadata.is_file():
            title = metadata.read_text(encoding='utf-8').splitlines()[0].lstrip('# ')
            case = cases.get_case(path.name, base=base)
            timeline_file = case.timeline_dir / 'timeline.jsonl'
            count = sum(bool(line.strip()) for line in timeline_file.read_text(encoding='utf-8').splitlines()) if timeline_file.exists() else 0
            rows.append((case.case_id, title, len(cases.read_custody(case)), count))
    print(_table(['ID', 'Título', 'Evidências', 'Eventos'], rows), end='')
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    arguments = list(sys.argv[1:] if argv is None else argv)
    try:
        args = _parser().parse_args(arguments)
        if args.command == 'ui':
            from .ui.server import run
            return run(case_base=args.casos, port=args.porta, case_id=args.caso,
                       open_browser=not args.sem_navegador, token=args.token)
        if args.command == 'casos':
            return _list_cases(args.casos)
        if args.command == 'novo-caso':
            case = cases.create_case(args.id, titulo=args.titulo, responsavel=args.responsavel, base=args.casos)
            print(case.path)
            return 0
        case = cases.get_case(args.id, base=args.casos)
        if args.command == 'evidencia':
            for path in args.caminhos:
                print(cases.add_evidence(case, path, fonte=args.fonte, observacao=args.obs))
            return 0
        if args.command == 'ingerir':
            return _ingest(case, args)
        if args.command == 'timeline':
            return _view(case, args)
        if args.command == 'verificar':
            return _verify(case)
        events = _full_timeline(case)
        if args.command == 'pivo':
            selected = timeline.filter_events(events, **_filters(args))
            print(timeline.render_md(selected))
            print('## Entidades relacionadas\n')
            print(_entity_tables(selected), end='')
            return 0
        if args.command == 'iocs':
            return _ioc_output(case, events, args.gravar)
        return _summary(case, events)
    except SystemExit as exc:
        return 0 if exc.code == 0 else 1
    except (OSError, ValueError, TypeError, csv.Error) as exc:
        print(f'Erro: {exc}', file=sys.stderr)
        if '--debug' in arguments:
            traceback.print_exc()
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
