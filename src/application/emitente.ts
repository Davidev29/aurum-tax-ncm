/**
 * Caso de uso do **emitente** (timbrado dos relatórios).
 *
 * Guardado na store `meta` sob `META_KEYS.EMITENTE`, como na v1.
 */
import { EMITENTE_PADRAO, type Emitente } from '@/domain/entities'
import { META_KEYS } from '@/domain/constants'
import { db } from '@/infrastructure/db/schema'

export async function carregarEmitente(): Promise<Emitente> {
  const reg = await db.meta.get(META_KEYS.EMITENTE)
  const valor = reg?.valor as Partial<Emitente> | undefined
  if (!valor) return { ...EMITENTE_PADRAO }
  return { ...EMITENTE_PADRAO, ...valor }
}

export async function salvarEmitente(parcial: Partial<Emitente>): Promise<Emitente> {
  const atual = await carregarEmitente()
  const proximo: Emitente = { ...atual, ...parcial }
  await db.meta.put({ chave: META_KEYS.EMITENTE, valor: proximo, atualizadoEm: new Date().toISOString() })
  return proximo
}

export async function limparEmitente(): Promise<void> {
  await db.meta.delete(META_KEYS.EMITENTE)
}

/**
 * Aceita a imagem do logo e a reduz, se necessário (SPEC R8.16–R8.17).
 * Rejeita não-imagem e arquivos acima de 3 MB.
 */
export async function processarLogo(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Envie um arquivo de imagem.')
  if (file.size > 3 * 1024 * 1024) throw new Error('Imagem muito grande (máx. 3 MB).')
  const dataUrl = await new Promise<string>((ok, erro) => {
    const fr = new FileReader()
    fr.onload = () => ok(String(fr.result))
    fr.onerror = () => erro(new Error('Não foi possível ler a imagem.'))
    fr.readAsDataURL(file)
  })
  return redimensionarImagem(dataUrl, 600)
}

/** Redimensiona para no máximo 600px no maior lado (paridade com a v1). */
export function redimensionarImagem(dataUrl: string, ladoMax = 600): Promise<string> {
  if (!/^data:image\/(png|jpe?g|webp|gif)/.test(dataUrl)) return Promise.resolve(dataUrl)

  return new Promise((ok) => {
    const img = new Image()
    img.onload = () => {
      try {
        const ratio = Math.min(1, ladoMax / Math.max(img.width, img.height))
        // Imagem pequena e leve: mantém o original para não perder qualidade.
        if (ratio >= 1 && dataUrl.length < 300000) {
          ok(dataUrl)
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * ratio)
        canvas.height = Math.round(img.height * ratio)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          ok(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        ok(canvas.toDataURL('image/png'))
      } catch {
        ok(dataUrl)
      }
    }
    img.onerror = () => ok(dataUrl)
    img.src = dataUrl
  })
}

/** Aceita `#abc`/`#aabbcc` (com ou sem `#`). */
export function normalizarCor(valor: string): string | null {
  const v = valor.trim().startsWith('#') ? valor.trim() : `#${valor.trim()}`
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : null
}
