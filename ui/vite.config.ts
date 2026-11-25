// Configuração do Vite para a UI do Perito.
// - build sai em ../src/perito/ui/static (servido por `perito ui`)
// - dev em 127.0.0.1:5173 com proxy /api → servidor Python em 127.0.0.1:8765
// Observação: este arquivo fica fora do `tsc --noEmit` (só src/ é checado),
// por isso o acesso a process.env é feito via globalThis sem @types/node.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const token = env.PERITO_UI_TOKEN;
// Alvo da API no dev (padrão 8765). Use PERITO_UI_API=http://127.0.0.1:8766 para um servidor de teste com stubs.
const alvo = env.PERITO_UI_API || 'http://127.0.0.1:8765';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: '/',
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : '../src/perito/ui/static',
    emptyOutDir: true,
    // fixtures (public/) são só para desenvolvimento; não vão para o static do servidor
    copyPublicDir: mode === 'demo',
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: alvo,
        changeOrigin: true,
        headers: token ? { 'X-Perito-Token': token } : {},
      },
    },
  },
  preview: { host: '127.0.0.1', port: 4173 },
}));
