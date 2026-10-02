/**
 * Pré-carregamento dos testes.
 *
 * `fake-indexeddb/auto` substitui `indexedDB`/`IDBKeyRange` globais **antes**
 * de qualquer módulo de `src/` ser importado, de modo que o singleton Dexie de
 * `src/infrastructure/db/schema.ts` abra um banco real (em memória).
 *
 * Cada arquivo de teste roda em um worker próprio (isolate padrão do Vitest),
 * ou seja, em um IndexedDB limpo — não é necessário reiniciar o Dexie entre
 * arquivos. Dentro de um arquivo, cada teste limpa as stores que usa.
 */
import 'fake-indexeddb/auto'

/**
 * Shims mínimos de navegador para testes `node` que importam stores da UI
 * (`src/store/ui.ts` lê `localStorage`/tema no carregamento do módulo).
 * Não afetam os testes existentes: só preenchem o que não existe.
 */
{
  const g = globalThis as Record<string, unknown>
  if (typeof g.localStorage === 'undefined') {
    const mem = new Map<string, string>()
    g.localStorage = {
      getItem: (k: string) => mem.get(String(k)) ?? null,
      setItem: (k: string, v: string) => void mem.set(String(k), String(v)),
      removeItem: (k: string) => void mem.delete(String(k)),
      clear: () => mem.clear(),
    }
  }
  if (typeof g.window === 'undefined') {
    g.window = {
      matchMedia: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      setTimeout: setTimeout.bind(globalThis),
      clearTimeout: clearTimeout.bind(globalThis),
      requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
    }
  }
  if (typeof g.document === 'undefined') {
    g.document = {
      documentElement: { classList: { toggle: () => undefined } },
      getElementById: () => null,
    }
  }
}
