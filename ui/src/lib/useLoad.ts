// Carregamento assíncrono simples com estado {ok, v} | {ok:false, err} | null (carregando).
import { useEffect, useState } from 'react';
import { describeError } from './api';

export type Load<T> = { ok: true; v: T } | { ok: false; err: string } | null;

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Load<T> {
  const [st, setSt] = useState<Load<T>>(null);
  useEffect(() => {
    let vivo = true;
    setSt(null);
    fn()
      .then((v) => vivo && setSt({ ok: true, v }))
      .catch((e: unknown) => vivo && setSt({ ok: false, err: describeError(e) }));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return st;
}
