// Contrato comum das visões com o CaseShell (teclado global, busca "/" e Esc em camadas).
export interface ViewHandle {
  /** Trata a tecla; devolve true se consumiu. */
  onKey?(e: KeyboardEvent): boolean;
  search?(term: string): void;
  searchCommit?(term: string): void;
  searchCancel?(): void;
  /** Esc: devolve true se consumiu (ex.: limpou filtro local). */
  escape?(): boolean;
  focus?(): void;
}

/** Navegação j/k/h/l genérica numa lista de colunas; devolve nova posição ou null. */
export function moveKey(key: string, col: number, row: number, nCols: number, rowsIn: (c: number) => number): { col: number; row: number } | null {
  const clamp = (v: number, n: number) => Math.max(0, Math.min(Math.max(0, n - 1), v));
  switch (key) {
    case 'j':
    case 'ArrowDown':
      return { col, row: clamp(row + 1, rowsIn(col)) };
    case 'k':
    case 'ArrowUp':
      return { col, row: clamp(row - 1, rowsIn(col)) };
    case 'J':
    case 'PageDown':
      return { col, row: clamp(row + 10, rowsIn(col)) };
    case 'K':
    case 'PageUp':
      return { col, row: clamp(row - 10, rowsIn(col)) };
    case 'G':
    case 'End':
      return { col, row: clamp(rowsIn(col) - 1, rowsIn(col)) };
    case 'Home':
      return { col, row: 0 };
    case 'h':
    case 'ArrowLeft': {
      const c = clamp(col - 1, nCols);
      return { col: c, row: clamp(row, rowsIn(c)) };
    }
    case 'l':
    case 'ArrowRight': {
      const c = clamp(col + 1, nCols);
      return { col: c, row: clamp(row, rowsIn(c)) };
    }
    default:
      return null;
  }
}
