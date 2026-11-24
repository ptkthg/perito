// Técnicas confirmadas (citadas em achados.md) disponíveis para o app inteiro:
// técnica confirmada perde o "?" em todas as visões.
import { createContext, useContext } from 'react';
import { type Confirmadas, VAZIO_CONF } from './bancada';

export const ConfContext = createContext<Confirmadas>(VAZIO_CONF);
export const useConfirmadas = (): Confirmadas => useContext(ConfContext);
