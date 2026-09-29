/// <reference types="vite/client" />

/**
 * Declarações de módulos literais do `pdfmake`.
 *
 * O `package.json` do pdfmake aponta `browser` para `build/pdfmake.js`, mas os
 * caminhos sub-`paths` (`/build/...`) não têm tipos em `@types/pdfmake`, que
 * só descreve a entrada principal. Como estamos no renderer (navegador),
 * importamos os artefatos de build explicitamente — assim não dependemos da
 * resolução do campo `browser` e o bundle é determinístico.
 */
declare module 'pdfmake/build/pdfmake' {
  import type { TCreatedPdf, TDocumentDefinitions, TFontDictionary, TVirtualFileSystem } from 'pdfmake/interfaces'

  interface PdfMakeBrowser {
    createPdf(documentDefinitions: TDocumentDefinitions, options?: unknown): TCreatedPdf
    readonly fonts: TFontDictionary
    addVirtualFileSystem(vfs: TVirtualFileSystem): void
    addFonts(fonts: TFontDictionary): void
    setFonts(fonts: TFontDictionary): void
  }

  const pdfMake: PdfMakeBrowser
  export default pdfMake
}

declare module 'pdfmake/build/vfs_fonts' {
  const vfs: Record<string, string>
  export default vfs
}

declare module 'pdfmake/build/standard-fonts/Courier' {
  interface PacoteFontePadrao {
    vfs: Record<string, string>
    fonts: Record<string, { normal: string; bold: string; italics: string; bolditalics: string }>
  }
  const pacote: PacoteFontePadrao
  export default pacote
}
