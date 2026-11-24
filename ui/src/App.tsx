// Raiz: escolhe entre a seleção de casos (#/) e o console do caso (#/caso/<ID>/<visao>).
// Sem visão na URL: GUIADO abre a Visão Geral; ANALISTA abre a timeline.
import { useEffect, useState } from 'react';
import { useRoute } from './lib/route';
import { CaseSelect } from './components/CaseSelect';
import { CaseShell } from './components/CaseShell';
import { loadDensidade, loadTema } from './lib/prefs';
import { type Modo, ModoContext, loadModo, saveModo } from './lib/mode';

export function App() {
  const route = useRoute();
  const [modo, setModo] = useState<Modo>(loadModo);

  // Preferências globais aplicadas no <html> antes do primeiro uso.
  useEffect(() => {
    document.documentElement.style.setProperty('--row-h', `${loadDensidade()}px`);
    if (loadTema() === 'claro') document.documentElement.dataset.theme = 'light';
  }, []);

  useEffect(() => {
    saveModo(modo);
    document.documentElement.dataset.modo = modo;
  }, [modo]);

  return (
    <ModoContext.Provider value={modo}>
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
    </ModoContext.Provider>
  );
}
