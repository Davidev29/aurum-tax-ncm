/**
 * Tipos para `scripts/build-grafo.mjs` (JS sem tipos), importado por
 * `tests/grafo-base.test.ts` para testar o núcleo puro do grafo fiscal
 * (Phase 10-01). Tipos frouxos de propósito: o contrato preciso é
 * verificado pelos testes em runtime, não pelo `tsc`.
 */
export declare const GRAFO_VERSAO: string
export declare const ANO_REFERENCIA: number
export declare const ORIGENS: string[]
export declare const MAX_SINONIMO_POR_TERMO: number
export declare function dedupePorChave<T>(lista: unknown, chaveFn: (x: any) => string): { unicos: T[]; duplicados: number }
export declare function ehRevogadoNomenclatura(item: unknown): boolean
export declare function normalizarTermo(s: unknown): string
export declare function normalizarAnexo(nome: unknown): string
export declare function comProveniencia(origem: string, confianca: unknown, anoReferencia?: number): any
export declare function sha256Hex(dados: any): string
export declare function construirGrafo(entradas?: any): { nodos: any[]; arestas: any[]; relatorio: any }
export declare function hashGrafo(nodos: unknown, arestas: unknown): string
export declare function calcularHashBaseAtual(dirBase?: string): Promise<string | null>
export declare function buildGrafo(opcoes?: any): Promise<any>
