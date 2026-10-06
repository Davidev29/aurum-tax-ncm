/**
 * GRAFO-04 — tooling KGLite: `--check` verde + `describe()` com nós fiscais.
 *
 * Chama `python scripts/grafo/build-grafo-kglite.py` via `execFileSync`
 * (nenhum `.kgl` é importado no app — só artefatos de curadoria em
 * `recursos-ia/grafo/`).
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts', 'grafo', 'build-grafo-kglite.py');
const DESCRIBE_TXT = join(ROOT, 'recursos-ia', 'grafo', 'describe.txt');

/** `python` no Windows, `python3` no resto; tenta ambos antes de falhar. */
function rodarPy(args: string[]): string {
  const candidatos = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  let ultimoErro: unknown = null;
  for (const bin of candidatos) {
    try {
      return execFileSync(bin, [SCRIPT, ...args], { encoding: 'utf8', cwd: ROOT });
    } catch (err) {
      ultimoErro = err;
    }
  }
  throw ultimoErro;
}

describe('grafo-kglite — check do schema', () => {
  it('--check: schema_ok true (kglite ausente não falha)', () => {
    const saida = rodarPy(['--check']);
    const r = JSON.parse(saida) as { schema_ok: boolean; faltando: string[]; kglite_ok: boolean };
    expect(r.faltando ?? []).toEqual([]);
    expect(r.schema_ok).toBe(true);
    expect(typeof r.kglite_ok).toBe('boolean');
  }, 60_000);

  it('describe(): describe.txt contém NCM/CCT/Anexo', () => {
    rodarPy(['--describe']);
    expect(existsSync(DESCRIBE_TXT), 'describe.txt ausente — rode --describe').toBe(true);
    const txt = readFileSync(DESCRIBE_TXT, 'utf8');
    for (const token of ['NCM', 'CCT', 'Anexo']) {
      expect(txt, `describe.txt sem ${token}`).toContain(token);
    }
  }, 60_000);
});
