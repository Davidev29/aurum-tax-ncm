/**
 * Casos de uso da base tributÃ¡ria.
 *
 * A base Ã© *semeada no primeiro uso* a partir de `public/base/` (gerada por
 * `scripts/build-base.mjs` a partir dos trÃªs JSONs oficiais). Ã‰ isso que
 * substitui a importaÃ§Ã£o manual da v1: o `classificacao_tributaria.json` vem
 * embutido no pacote e o usuÃ¡rio nunca precisa procurar por um arquivo.
 *
 * A importaÃ§Ã£o manual continua disponÃ­vel para quem quiser sobrescrever a base
 * com uma versÃ£o mais nova dos JSONs oficiais (formatos originais).
 */
import {
  apagarBaseImportada,
  importarBase,
  semearBaseEmbutida,
  statusBase,
  ARQUIVOS_BASE,
  type FormatoBase,
  type StatusBase,
} from '@/infrastructure/base/base-service'
import { garantirSementes } from './auxiliares'
import { SEED_CFOP, SEED_CST_ICMS, SEED_CST_PISCOFINS } from '@/domain/constants/seeds'
import type { Progresso } from '@/infrastructure/base/base-service'

/** Sementes das tabelas simples (CFOP / CST ICMS / CST PIS-COFINS). */
const SEMENTES = {
  cfop: SEED_CFOP,
  cstIcms: SEED_CST_ICMS,
  cstPisCofins: SEED_CST_PISCOFINS,
}

const semearAuxiliares = (): Promise<void> => garantirSementes(SEMENTES)

export type { StatusBase, FormatoBase, Progresso }
export { ARQUIVOS_BASE }

/**
 * InicializaÃ§Ã£o Ãºnica da aplicaÃ§Ã£o: semear a base embutida e as tabelas
 * auxiliares de apoio (CFOP, CST ICMS/PIS-COFINS, observaÃ§Ãµes legais).
 *
 * Idempotente â€” chamadas seguintes apenas conferem o status.
 */
export async function inicializarBase(onProgress: Progresso = () => {}): Promise<StatusBase> {
  onProgress('Verificando base tributÃ¡ria', 2)
  const status = await semearBaseEmbutida(onProgress)
  await semearAuxiliares()
  onProgress('Base pronta', 100)
  return status
}

/** RelÃª a base embutida, substituindo integralmente o conteÃºdo atual. */
export async function resemearBase(onProgress: Progresso = () => {}): Promise<StatusBase> {
  const status = await semearBaseEmbutida(onProgress, true)
  await semearAuxiliares()
  return status
}

/**
 * Importa um JSON no formato oficial (reforma / nomenclatura / classificaÃ§Ã£o).
 * Uso opcional â€” a base embutida jÃ¡ cobre o caso normal.
 */
export async function importarArquivoBase(
  json: unknown,
  nomeArquivo: string,
  onProgress: Progresso,
): Promise<FormatoBase> {
  const formato = await importarBase(json, nomeArquivo, onProgress)
  await semearAuxiliares()
  return formato
}

/** Apaga a base (guardado atrÃ¡s de confirmaÃ§Ã£o na UI) e a resemeia em seguida. */
export async function restaurarBasePadrao(onProgress: Progresso = () => {}): Promise<StatusBase> {
  onProgress('Apagando base atual', 5)
  await apagarBaseImportada()
  return resemearBase(onProgress)
}

/**
 * Apaga a base importada **sem** resemear (SPEC R10.12): NCM, CST, cClassTrib,
 * referências, nomenclatura e NBS. Empresas, produtos e tabelas auxiliares de
 * usuário são mantidos.
 */
export async function apagarBase(): Promise<void> {
  await apagarBaseImportada()
}

export { statusBase }
