// Raiz: escolhe entre a seleção de casos (#/) e o console do caso (#/caso/<ID>/<visao>).
// Sem visão na URL: GUIADO abre a Visão Geral; ANALISTA abre a timeline.
import { lazy, Suspense, useEffect, useState } from 'react';
import { useRoute } from './lib/route';
import { CaseSelect } from './components/CaseSelect';
import { CaseShell } from './components/CaseShell';
import { loadTema } from './lib/prefs';
import { type Modo, ModoContext, loadModo, saveModo } from './lib/mode';
import { ErrorBoundary } from './components/ErrorBoundary';

// O Vite remove este import e seu CSS do build normal.
const DemoApp = import.meta.env.VITE_DEMO === '1' ? lazy(() => import('./demo/DemoApp')) : null;

export function App() {
  const route = useRoute();
  const [modo, setModo] = useState<Modo>(loadModo);

  // Preferências globais aplicadas no <html> antes do primeiro uso.
  useEffect(() => {
    if (loadTema() === 'claro') document.documentElement.dataset.theme = 'light';
  }, []);

  useEffect(() => {
    saveModo(modo);
    document.documentElement.dataset.modo = modo;
  }, [modo]);

  return (
    <ModoContext.Provider value={modo}>
      <ErrorBoundary label="APP" chave="app">
      {DemoApp ? (
        <Suspense fallback={<p>Carregando…</p>}>
          <DemoApp route={route} modo={modo} onModo={setModo} />
        </Suspense>
      ) : !route.caso ? (
        <CaseSelect />
      ) : (
        <CaseShell
          key={route.caso}
          caso={route.caso}
          visao={route.visao ?? (modo === 'guiado' ? 'visao' : 'timeline')}
          modo={modo}
          onModo={setModo}
        />
      )}
      </ErrorBoundary>
    </ModoContext.Provider>
  );
}
