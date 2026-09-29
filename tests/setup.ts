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
