import { bridge } from '../bridge'
import type { NotaXml } from '../nfe/tipos'

/**
 * Persistência dos arquivos `.xml` importados.
 *
 * - **Electron**: bytes vão ao disco (`userData/xml/<cnpj>/<chave>.xml`, via
 *   IPC); no banco fica só o caminho relativo.
 * - **Navegador (sem bridge)**: o conteúdo integral vai ao registro da nota
 *   (`xmlConteudo`), com trava de 5 MB por arquivo para não estourar o
 *   IndexedDB.
 */
const LIMITE_WEB_BYTES = 5 * 1024 * 1024

export async function salvarXmlImportado(
  empresaCnpj: string,
  chave: string,
  conteudo: string,
): Promise<{ arquivo: string | null; xmlConteudo: string | null }> {
  if (bridge) {
    const arquivo = await bridge.salvarXml({ cnpj: empresaCnpj, chave, conteudo })
    return { arquivo, xmlConteudo: null }
  }
  if (new Blob([conteudo]).size > LIMITE_WEB_BYTES) {
    throw new Error('XML acima de 5 MB: use o aplicativo desktop para importar.')
  }
  return { arquivo: null, xmlConteudo: conteudo }
}

/** Recupera o XML íntegro da nota, do disco ou do registro. */
export async function lerXmlImportado(nota: Pick<NotaXml, 'arquivo' | 'xmlConteudo'>): Promise<string> {
  if (nota.xmlConteudo) return nota.xmlConteudo
  if (nota.arquivo && bridge) return bridge.lerXml(nota.arquivo)
  throw new Error('XML original indisponível (arquivo não localizado).')
}

/** Remove o XML do disco; no modo web não há o que remover. */
export async function removerXmlImportado(arquivo: string | null): Promise<void> {
  if (arquivo && bridge) await bridge.removerXml(arquivo)
}
