// Raiz: escolhe entre a seleção de casos (#/) e o console do caso (#/caso/<ID>/<visao>).
// Sem visão na URL: GUIADO abre a Visão Geral; ANALISTA abre a timeline.
import { useEffect, useState } from 'react';
import { useRoute } from './lib/route';
import { CaseSelect } from './components/CaseSelect';
import { CaseShell } from './components/CaseShell';
import { loadTema } from './lib/prefs';
import { type Modo, ModoContext, loadModo, saveModo } from './lib/mode';
import { ErrorBoundary } from './components/ErrorBoundary';

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
      {!route.caso ? (
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
