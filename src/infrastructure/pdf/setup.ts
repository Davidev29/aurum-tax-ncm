/**
 * Configuração do gerador de PDF.
 *
 * O app anterior usava **jsPDF + jspdf-autotable**, exigindo cálculo manual de
 * alturas, quebras de página e cabeçalhos. Aqui o relatório é declarativo
 * (pdfMake): quebra de página, cabeçalho/rodapé e numeração são resolvidos pelo
 * próprio motor.
 *
 * Fontes:
 *  - `Roboto`  → texto corrente (embutida no `vfs_fonts`);
 *  - `Courier` → colunas de identificadores (NCM, CST, CFOP) para alinhamento
 *    monoespaçado — vem do pacote `pdfmake/build/standard-fonts` e precisa ser
 *    registrada explicitamente no vfs, senão o pdfMake lança
 *    "File 'data/Courier.afm' not found in virtual file system".
 *
 * A inicialização é idempotente e roda no import, de modo que qualquer módulo
 * que importe os relatórios já encontra o motor pronto.
 */
import pdfMake from 'pdfmake/build/pdfmake'
import vfsRoboto from 'pdfmake/build/vfs_fonts'
import pacoteCourier from 'pdfmake/build/standard-fonts/Courier'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'

let inicializado = false

function inicializarPdf(): void {
  if (inicializado) return
  inicializado = true

  pdfMake.addVirtualFileSystem({ ...vfsRoboto, ...pacoteCourier.vfs })

  // Só a variante normal: os relatórios nunca usam itálico/bold em Courier.
  const courier = pacoteCourier.fonts.Courier
  pdfMake.addFonts({ Courier: courier })
}

inicializarPdf()

export { pdfMake }
export type { TDocumentDefinitions }

/** Serializa o documento e dispara o download no navegador/Electron. */
export function baixarPdf(doc: TDocumentDefinitions, nomeArquivo: string): Promise<void> {
  inicializarPdf()
  return pdfMake.createPdf(doc).download(nomeArquivo)
}

/** Abre o PDF no visualizador nativo (usado para pré-visualização). */
export function abrirPdf(doc: TDocumentDefinitions): Promise<void> {
  inicializarPdf()
  return pdfMake.createPdf(doc).open()
}
