// Recria o .gitkeep em src/perito/ui/static depois do build (emptyOutDir apaga tudo).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../src/perito/ui/static');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, '.gitkeep'), '');
console.log(`postbuild: .gitkeep recriado em ${out}`);
