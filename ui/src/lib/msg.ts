// Linha de status (brief §10): "GLIFO VERBO OBJETO → DESTINO", com ações por tecla
// (ex.: [o] abrir no F6). A mensagem fica até a próxima ação, sem timer.
export type MsgKind = 'ok' | 'err' | 'info';

export interface MsgAcao {
  tecla: string;
  rotulo: string;
  fazer(): void;
}
