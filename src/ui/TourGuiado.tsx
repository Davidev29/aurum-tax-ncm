/**
 * Tour guiado — tutorial menu a menu em interface elegante.
 *
 * Tela 100% informativa (sem navegação forçada):
 * - cabeçalho em degradê marinho→ouro + escudo
 * - barra de progresso + dots clicáveis
 * - quadro ilustrativo vivo: miniatura do menu lateral com cursor em LOOP
 *   CONTÍNUO (desliza → clica com ripple + flash no item → pausa → repete)
 *   + prévia animada própria de cada módulo + legenda explicativa
 * - mini-menu clicável (pula para o passo), cards com hover, tudo em loop
 * - "o que faz" + "como usar" + dica
 * - Anterior/Próximo/Pular/Concluir
 * - framer-motion com respeito a prefers-reduced-motion
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { PASSOS_TOUR } from '@/domain/tutorial'
import { useTutorial } from '@/store/tutorial'
import { Btn } from './kit'
import { EscudoAurum } from './Marca'

const TRANSICAO = { type: 'spring', stiffness: 300, damping: 28 } as const
/** Duração do loop do cursor (chegada → clique → respiro → retorno). */
const LOOP = 4.4
const TEMPOS = [0, 0.24, 0.46, 0.54, 0.66, 0.86, 1] as const

/** Seção do menu lateral real (espelha `Layout.tsx` > NAV). */
function secaoDoPasso(indice: number): { secao: string; pos: number; de: number } {
  if (indice <= 6) return { secao: 'Trabalho', pos: indice + 1, de: 7 }
  if (indice <= 8) return { secao: 'Dados', pos: indice - 6, de: 2 }
  return { secao: 'Referência', pos: 1, de: 1 }
}

/**
 * Cursor em loop contínuo: nasce no conteúdo → desliza até o item →
 * PRESSIONA (escala + ripple duplo + etiqueta "clique!") → solta →
 * flutua um instante → some e recomeça. Nunca para enquanto a tela
 * estiver aberta.
 */
function CursorMouse({ reduzir }: { reduzir: boolean }) {
  if (reduzir) {
    return (
      <span aria-hidden="true" className="tour-cursor pointer-events-none absolute -right-2 top-1/2 z-10 -translate-y-1/2">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M5 3.5 19 11.2l-6.4 1.2L10.2 19 5 3.5Z" fill="#fff" stroke="#0f172a" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  return (
    <motion.span
      aria-hidden="true"
      className="tour-cursor pointer-events-none absolute -right-2 top-1/2 z-10 -translate-y-1/2"
      initial={false}
      animate={{
        x: [88, 0, 0, 0, 0, 26, 88],
        y: [50, 0, 0, 0, 0, 16, 50],
        opacity: [0, 1, 1, 1, 1, 1, 0],
      }}
      transition={{ duration: LOOP, repeat: Infinity, ease: 'easeInOut', times: [...TEMPOS] }}
    >
      <motion.span
        className="relative block"
        animate={{ scale: [1, 1, 1, 0.78, 1, 1, 1], x: [0, 0, 0, -1.5, 0, 0, 0], y: [0, 0, 0, -1, 0, 0, 0] }}
        transition={{ duration: LOOP, repeat: Infinity, ease: 'easeInOut', times: [...TEMPOS] }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="tour-cursor-sombra drop-shadow-[0_4px_10px_rgb(2_6_23/0.45)]">
          <path d="M5 3.5 19 11.2l-6.4 1.2L10.2 19 5 3.5Z" fill="#fff" stroke="#0f172a" strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx="18.6" cy="18.6" r="2.1" fill="#e8c15a" stroke="#0f172a" strokeWidth="1.2" />
        </svg>
        {/* ripple duplo do clique */}
        {[0, 1].map((k) => (
          <motion.span
            key={k}
            aria-hidden="true"
            className="absolute -left-1.5 top-1.5 h-6 w-6 rounded-full border-2 border-aurum-400"
            initial={false}
            animate={{ opacity: [0, 0, 0, 0.95, 0, 0, 0], scale: [0.4, 0.4, 0.4, 0.7, 1.7, 1.7, 1.7] }}
            transition={{ duration: LOOP, repeat: Infinity, ease: 'easeOut', times: [...TEMPOS], delay: k * 0.16 }}
          />
        ))}
        {/* etiqueta "clique!" sincronizada com a pressão */}
        <motion.span
          aria-hidden="true"
          className="absolute -top-6 left-3 whitespace-nowrap rounded-full bg-brand-950 px-1.5 py-px text-[9px] font-black uppercase tracking-wider text-aurum-200 shadow-lg ring-1 ring-aurum-400/60"
          initial={false}
          animate={{ opacity: [0, 0, 0, 1, 1, 0, 0], y: [4, 4, 4, 0, 0, -3, -3], scale: [0.8, 0.8, 0.8, 1, 1, 0.9, 0.9] }}
          transition={{ duration: LOOP, repeat: Infinity, ease: 'easeOut', times: [...TEMPOS] }}
        >
          clique!
        </motion.span>
      </motion.span>
    </motion.span>
  )
}

/** Barra que enche e esvazia em loop — base das prévias. */
function Barra({ de = '12%', para = '82%', duracao = 3.2, atraso = 0, classe = '' }: { de?: string; para?: string; duracao?: number; atraso?: number; classe?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10 ${classe}`}>
      <motion.div
        aria-hidden="true"
        className="h-full rounded-full bg-gradient-to-r from-brand-600 via-brand-500 to-aurum-400"
        initial={false}
        animate={{ width: [de, para, para, de] }}
        transition={{ duration: duracao, repeat: Infinity, ease: 'easeInOut', times: [0, 0.4, 0.65, 1], delay: atraso }}
      />
    </div>
  )
}

function PontoDigitando({ atraso = 0 }: { atraso?: number }) {
  return (
    <motion.span
      aria-hidden="true"
      className="inline-block h-3.5 w-1.5 rounded-sm bg-brand-500"
      initial={false}
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 0.9, repeat: Infinity, delay: atraso }}
    />
  )
}

/**
 * Prévia viva e própria de cada módulo — cada `id` tem sua microcena em
 * loop (digitação, enchimento, duelo de barras, carimbo...). Tudo
 * decorativo (`aria-hidden`) + `whileHover` para responder ao mouse.
 */
function PreviaModulo({ id, reduzir }: { id: string; reduzir: boolean }) {
  if (reduzir) {
    return (
      <div aria-hidden="true" className="mt-3 space-y-2">
        <div className="h-2 w-11/12 rounded-full bg-slate-400/25" />
        <div className="h-2 w-9/12 rounded-full bg-slate-400/20" />
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="h-12 rounded-xl border border-[var(--line)] bg-white/50 dark:bg-white/5" />
          <div className="h-12 rounded-xl border border-aurum-500/30 bg-aurum-100/50 dark:bg-aurum-400/10" />
          <div className="h-12 rounded-xl border border-[var(--line)] bg-white/50 dark:bg-white/5" />
        </div>
      </div>
    )
  }

  const cartao =
    'rounded-xl border border-slate-200 bg-white p-2 text-slate-700 shadow-sm dark:border-white/10 dark:bg-slate-900 dark:text-slate-200'

  switch (id) {
    case 'calculadora':
      return (
        <div aria-hidden="true" className="mt-3 space-y-2">
          {['Arroz 5kg ×2', 'Azeite 500ml ×1'].map((t, i) => (
            <motion.div key={t} className={`${cartao} flex items-center gap-2 text-[10px] font-bold`} whileHover={{ scale: 1.03 }} animate={{ x: [0, 4, 0] }} transition={{ duration: 3, repeat: Infinity, delay: i * 0.5 }}>
              <span className="grid h-5 w-5 place-items-center rounded-md bg-brand-900 text-[10px] text-white">{i + 1}</span>
              <span className="flex-1 truncate">{t}</span>
              <motion.span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-black text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}>na cesta</motion.span>
            </motion.div>
          ))}
          <div className={`${cartao} !border-aurum-500/40 !bg-aurum-100/50 dark:!bg-aurum-400/10`}>
            <div className="mb-1.5 flex justify-between text-[10px] font-black uppercase tracking-wider text-brand-800 dark:text-aurum-200"><span>Total IBS+CBS</span><motion.span animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 2.4, repeat: Infinity }}>R$ 42,18</motion.span></div>
            <Barra para="78%" duracao={3.4} />
            <div className="mt-1.5 flex gap-1.5">
              {['IBS R$ 28,4', 'CBS R$ 13,7', 'carga 12,4%'].map((t, i) => (
                <motion.span key={t} className="rounded-full bg-brand-950 px-1.5 py-px text-[10px] font-bold text-aurum-200" animate={{ y: [0, -3, 0] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.3 }}>{t}</motion.span>
              ))}
            </div>
          </div>
        </div>
      )
    case 'simples':
      return (
        <div aria-hidden="true" className="mt-3 space-y-2">
          <div className="flex items-center gap-1.5">
            {[1, 2, 3].map((n, i) => (
              <motion.span key={n} className="flex items-center gap-1.5" animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut', delay: i * 0.9 }}>
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[9px] font-black ${i === 2 ? 'bg-aurum-400 text-brand-950' : 'bg-brand-900 text-white'}`}>{n}</span>
                {i < 2 && <span className="h-px w-4 bg-slate-400/40" />}
              </motion.span>
            ))}
            <span className="ml-auto text-[10px] font-bold text-slate-500 dark:text-slate-400">Manual · CNPJ · cálculo</span>
          </div>
          {[['Convencional', '64%', 'from-slate-400 to-slate-500'], ['Híbrido ✨', '46%', 'from-emerald-500 to-emerald-400']].map(([rot, w, grad], i) => (
            <div key={rot as string} className={cartao}>
              <div className="mb-1 flex justify-between text-[10px] font-black uppercase tracking-wider"><span>{rot}</span><span>DAS</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-400/20">
                <motion.div className={`h-full rounded-full bg-gradient-to-r ${grad}`} initial={false} animate={{ width: [i === 0 ? '30%' : '20%', w as string, w as string, i === 0 ? '30%' : '20%'] }} transition={{ duration: 3.6, repeat: Infinity, times: [0, 0.4, 0.7, 1] }} />
              </div>
            </div>
          ))}
        </div>
      )
    case 'consulta':
      return (
        <div aria-hidden="true" className="mt-3 space-y-2">
          <motion.div className={`${cartao} flex items-center gap-1.5 font-mono text-[11px] font-black`} whileHover={{ scale: 1.02 }} animate={{ borderColor: ['rgb(148 163 184 / 0.35)', 'rgb(190 148 51 / 0.9)', 'rgb(148 163 184 / 0.35)'] }} transition={{ duration: 3, repeat: Infinity }}>
            <span className="text-slate-400">🔍</span>
            <span>0201.10.00</span>
            <PontoDigitando />
          </motion.div>
          <motion.div className={`${cartao} relative overflow-hidden !border-emerald-500/50`} initial={false} animate={{ y: [0, -2, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
            <div className="flex items-center gap-1.5 text-[10px] font-black"><span className="rounded-full bg-emerald-100 px-1.5 py-px text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">CST 000</span><span>cClass 000001</span></div>
            <Barra de="30%" para="92%" duracao={4} classe="mt-1.5" />
            <div className="mt-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">⚖️ art. 128 · deep-link aceso</div>
            <motion.span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-12 bg-gradient-to-r from-transparent via-aurum-300/40 to-transparent" initial={false} animate={{ x: ['-60px', '240px'] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} />
          </motion.div>
        </div>
      )
    case 'servicos':
      return (
        <div aria-hidden="true" className="mt-3 space-y-2">
          <div className="flex gap-1.5">
            {['Manual', 'por CNPJ'].map((t, i) => (
              <motion.span key={t} className={`rounded-full px-2 py-0.5 text-[10px] font-black ${i === 0 ? 'bg-brand-950 text-aurum-200' : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300'}`} animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.6 }}>{t}</motion.span>
            ))}
          </div>
          {['NBS 123456789 · aula online', 'NBS 987654321 · consultoria'].map((t, i) => (
            <motion.div key={t} className={`${cartao} flex items-center gap-2 text-[10px] font-bold`} whileHover={{ x: 4 }} animate={{ x: [0, 5, 0] }} transition={{ duration: 3, repeat: Infinity, delay: i * 0.7 }}>
              <span className="text-sm">🧰</span><span className="flex-1 truncate">{t}</span>
              <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-black text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">✓ trilha</span>
            </motion.div>
          ))}
        </div>
      )
    case 'cnaes':
      return (
        <div aria-hidden="true" className="mt-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <motion.span className={`${cartao} !py-1 text-[10px] font-black`} animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 2.4, repeat: Infinity }}>🏢 8599-6/99</motion.span>
            <motion.span className="text-brand-600" animate={{ x: [0, 5, 0], opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.8, repeat: Infinity }}>→</motion.span>
            <motion.span className="rounded-full bg-brand-950 px-2 py-1 text-[10px] font-black text-aurum-200" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2.4, repeat: Infinity, delay: 0.4 }}>Anexo III</motion.span>
            <motion.span className="rounded-full bg-aurum-400/30 px-2 py-1 text-[10px] font-black text-brand-950 dark:text-aurum-200" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2.4, repeat: Infinity, delay: 0.8 }}>→ NBS</motion.span>
          </div>
          <Barra de="20%" para="70%" duracao={3} />
          <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Fator R acende quando há folha · ponte CNAE → NBS</div>
        </div>
      )
    case 'lote':
      return (
        <div aria-hidden="true" className="mt-3 space-y-2">
          <motion.div className="grid place-items-center rounded-xl border-2 border-dashed border-brand-400/50 bg-brand-50/50 py-2.5 text-[10px] font-black text-brand-700 dark:bg-brand-950/30 dark:text-brand-200" whileHover={{ scale: 1.02 }} animate={{ y: [0, -3, 0] }} transition={{ duration: 2.6, repeat: Infinity }}>
            <motion.span animate={{ y: [0, -4, 0], rotate: [0, -6, 0] }} transition={{ duration: 2.6, repeat: Infinity }} className="text-lg">📁</motion.span>
            arraste o CSV/XLSX aqui
          </motion.div>
          <div className="flex flex-wrap gap-1.5">
            {[['✓ 186 classificadas', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'], ['⚠ 6 regra geral', 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'], ['⛔ 2 inválidas', 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200']].map(([t, c], i) => (
              <motion.span key={t as string} className={`rounded-full px-2 py-0.5 text-[10px] font-black ${c}`} animate={{ scale: [1, 1.07, 1] }} transition={{ duration: 2, repeat: Infinity, delay: i * 0.35 }}>{t}</motion.span>
            ))}
          </div>
          <Barra para="88%" duracao={3} />
        </div>
      )
    case 'nfe':
      return (
        <div aria-hidden="true" className="mt-3 space-y-2">
          <motion.div className={`${cartao} flex items-center gap-2 !border-emerald-500/40`} whileHover={{ scale: 1.02 }} animate={{ boxShadow: ['0 0 0 0 rgb(16 185 129 / 0)', '0 0 0 4px rgb(16 185 129 / 0.18)', '0 0 0 0 rgb(16 185 129 / 0)'] }} transition={{ duration: 2.8, repeat: Infinity }}>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500 text-sm text-white">✓</span>
            <div className="flex-1"><div className="text-[10px] font-black">Saldo credor · R$ 1.240</div><Barra de="40%" para="72%" duracao={2.8} classe="mt-1" /></div>
          </motion.div>
          <div className="flex gap-1">
            {['Notas', 'Fornec.', 'Prod.', 'NCM', 'Insights'].map((t, i) => (
              <motion.span key={t} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${i === 4 ? 'bg-aurum-400/40 text-brand-950 dark:text-aurum-200' : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300'}`} animate={{ y: [0, -2, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2 }}>{t}</motion.span>
            ))}
          </div>
        </div>
      )
    case 'produtos':
      return (
        <div aria-hidden="true" className="mt-3 space-y-1.5">
          {['Café 500g · 09012100', 'Sabão 1kg · 34012090', 'Papel A4 · 48025610'].map((t, i) => (
            <motion.div key={t} className={`${cartao} relative flex items-center gap-2 overflow-hidden !py-1.5 text-[11px] font-bold`} whileHover={{ x: 4 }} initial={false} animate={{ y: [0, -1.5, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: i * 0.6 }}>
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-brand-900 text-[10px] text-white">📦</span>
              <span className="flex-1 truncate">{t}</span>
              <motion.span className="pointer-events-none absolute inset-y-0 w-10 bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/10" initial={false} animate={{ x: ['-60px', '220px', '220px', '-60px'] }} transition={{ duration: 3.4, repeat: Infinity, delay: i * 0.6 }} />
              <span className="text-slate-400">✎ 🗑</span>
            </motion.div>
          ))}
        </div>
      )
    case 'auxiliares':
      return (
        <div aria-hidden="true" className="mt-3">
          <div className="grid grid-cols-4 gap-1.5">
            {['CST', 'cClass', 'NCM', 'CFOP', 'ICMS', 'PIS', 'COFINS', 'CNAE'].map((t, i) => (
              <motion.span key={t} className="grid place-items-center rounded-lg border border-slate-200 bg-white py-1.5 text-[10px] font-black text-slate-700 shadow-sm dark:border-white/10 dark:bg-slate-900 dark:text-slate-200" whileHover={{ scale: 1.1, rotate: -2 }} animate={{ scale: [1, 1.08, 1], borderColor: ['rgb(148 163 184 / 0.3)', 'rgb(190 148 51 / 0.8)', 'rgb(148 163 184 / 0.3)'] }} transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.28 }}>{t}</motion.span>
            ))}
          </div>
          <div className="mt-2 text-[10px] font-semibold text-slate-500 dark:text-slate-400">edição vale na hora p/ todo o cálculo · ✏️ na linha</div>
        </div>
      )
    default: // legislacao
      return (
        <div aria-hidden="true" className="mt-3 space-y-2">
          <motion.div className={`${cartao} flex items-center gap-2 !border-aurum-500/40`} whileHover={{ scale: 1.02 }} animate={{ rotate: [0, -0.6, 0.6, 0] }} transition={{ duration: 4, repeat: Infinity }}>
            <motion.span className="text-xl" animate={{ y: [0, -3, 0] }} transition={{ duration: 2.4, repeat: Infinity }}>⚖️</motion.span>
            <div className="flex-1"><div className="text-[11px] font-black">LC 214/2025 · leitura no app</div><div className="font-mono text-[10px] font-bold text-brand-700 dark:text-aurum-300">#art128 — cClassTrib do café ☕</div></div>
            <motion.span className="rounded-full bg-brand-950 px-1.5 py-px text-[10px] font-bold text-aurum-200" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 1.8, repeat: Infinity }}>abrir</motion.span>
          </motion.div>
          <div className="flex gap-1.5">
            {['Decreto 12.955', 'Res. CGIBS 6', 'RICMS-CE'].map((t, i) => (
              <motion.span key={t} className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300" animate={{ y: [0, -2, 0] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.3 }}>{t}</motion.span>
            ))}
          </div>
        </div>
      )
  }
}

/**
 * Quadro ilustrativo vivo: miniatura do app (menu lateral clicável +
 * prévia animada do módulo) com o cursor em loop + legenda.
 */
function QuadroMenu({ passo, reduzir, irPasso }: { passo: number; reduzir: boolean; irPasso: (n: number) => void }) {
  const atual = PASSOS_TOUR[passo]
  const grupos: { secao: string; indices: number[] }[] = [
    { secao: 'Trabalho', indices: [0, 1, 2, 3, 4, 5, 6] },
    { secao: 'Dados', indices: [7, 8] },
    { secao: 'Referência', indices: [9] },
  ]
  const info = secaoDoPasso(passo)

  return (
    <figure className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] shadow-[0_10px_36px_-14px_rgb(2_6_23/0.45)]">
      {/* barra da janela */}
      <div className="flex items-center gap-2 border-b border-[var(--line)] bg-slate-900 px-3 py-2 dark:bg-black/40">
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <i className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <i className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="min-w-0 flex-1 truncate text-center text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300">
          Aurum Tax NCM · menu lateral
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={passo}
            initial={reduzir ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="shrink-0 rounded-full bg-aurum-400/20 px-2 py-0.5 text-[10px] font-black text-aurum-200 ring-1 ring-inset ring-aurum-400/50"
          >
            {passo + 1}/{PASSOS_TOUR.length} · {atual.icone} {atual.menu}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="relative flex min-h-[15rem] text-left">
        {/* menu lateral em miniatura — CLICÁVEL, pula para o passo */}
        <div className="w-[11.5rem] shrink-0 space-y-2.5 border-r border-[var(--line)] bg-slate-950/[0.035] p-2.5 dark:bg-white/[0.03] sm:w-52">
          {grupos.map((g) => (
            <div key={g.secao}>
              <div className="px-1.5 pb-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {g.secao}
              </div>
              <ul className="space-y-1">
                {g.indices.map((i) => {
                  const p = PASSOS_TOUR[i]
                  const ativo = i === passo
                  return (
                    <li key={p.id} className="relative">
                      <motion.button
                        type="button"
                        title={`Ver ${p.menu} no tour`}
                        onClick={() => irPasso(i)}
                        whileHover={reduzir ? undefined : { x: 3 }}
                        whileTap={reduzir ? undefined : { scale: 0.97 }}
                        aria-current={ativo ? 'step' : undefined}
                        className={`relative flex w-full items-center gap-1.5 truncate rounded-lg px-2 py-[5px] text-left text-[11px] font-semibold transition-colors ${
                          ativo
                            ? 'bg-gradient-to-r from-brand-900 via-brand-700 to-brand-900 text-white shadow-[0_6px_18px_-8px_rgb(30_58_95/0.9)] ring-1 ring-inset ring-aurum-400/70'
                            : 'bg-[var(--surface)] text-[var(--ink-soft)] ring-1 ring-inset ring-[var(--line)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
                        }`}
                      >
                        <span aria-hidden="true" className="w-4 shrink-0 text-center text-[12px]">
                          {p.icone}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{p.menu}</span>
                        {ativo && !reduzir ? (
                          <>
                            <motion.span
                              aria-hidden="true"
                              className="absolute inset-0 rounded-lg"
                              initial={false}
                              animate={{ opacity: [0.85, 0.1, 0.85], scale: [1, 1, 0.965, 1, 1, 1, 1] }}
                              transition={{ duration: LOOP, repeat: Infinity, ease: 'easeInOut', times: [...TEMPOS] }}
                              style={{ boxShadow: '0 0 0 3px rgb(232 193 90 / 0.35)' }}
                            />
                            <CursorMouse reduzir={reduzir} />
                          </>
                        ) : null}
                        {ativo && reduzir ? <CursorMouse reduzir={reduzir} /> : null}
                      </motion.button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          <p className="px-1 pt-1 text-[10px] font-semibold leading-snug text-slate-500 dark:text-slate-400">💡 o menu acima é clicável — pula direto p/ o módulo</p>
        </div>

        {/* prévia viva do módulo atual */}
        <div className="relative min-w-0 flex-1 p-3">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={passo}
              initial={reduzir ? { opacity: 0 } : { opacity: 0, x: 26 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduzir ? { opacity: 0 } : { opacity: 0, x: -26 }}
              transition={reduzir ? { duration: 0.15 } : TRANSICAO}
              className="flex h-full flex-col"
            >
              <div className="flex items-center gap-2.5">
                <motion.span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-900 via-brand-700 to-brand-950 text-lg text-white ring-1 ring-inset ring-aurum-400/40"
                  animate={reduzir ? undefined : { rotate: [0, -8, 8, 0], scale: [1, 1.06, 1] }}
                  transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  {atual.icone}
                </motion.span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-black tracking-tight">{atual.menu}</div>
                  <div className="truncate text-[10px] text-slate-400">
                    seção {info.secao} · item {info.pos} de {info.de}
                  </div>
                </div>
                <span className="hidden shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-300 sm:inline-flex">
                  <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
                    {!reduzir && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  você está aqui
                </span>
              </div>

              <PreviaModulo id={atual.id} reduzir={reduzir} />

              <div className="mt-auto pt-2 text-[11px] font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                👆 O cursor <strong className="text-slate-600 dark:text-slate-200">clica sozinho em loop</strong> sobre{' '}
                <strong className="text-slate-600 dark:text-slate-200">“{atual.menu}”</strong> — é ali que este módulo mora no
                sistema real. Passe o mouse nos cartões ao lado p/ sentir a interação.
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <figcaption className="border-t border-[var(--line)] bg-slate-50 px-3.5 py-2 text-center text-[11px] leading-relaxed text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
        📍 No sistema, abra o <strong>menu lateral</strong> → seção <strong>{info.secao}</strong> → clique em{' '}
        <strong>
          {atual.icone} {atual.menu}
        </strong>{' '}
        (item {info.pos} de {info.de} da seção).
      </figcaption>
    </figure>
  )
}

export function TourGuiado() {
  const aberto = useTutorial((s) => s.aberto)
  const passo = useTutorial((s) => s.passo)
  const fechar = useTutorial((s) => s.fechar)
  const concluir = useTutorial((s) => s.concluir)
  const irPasso = useTutorial((s) => s.irPasso)
  const proximo = useTutorial((s) => s.proximo)
  const anterior = useTutorial((s) => s.anterior)
  const reduzir = useReducedMotion() ?? false

  const total = PASSOS_TOUR.length
  const atual = PASSOS_TOUR[Math.min(passo, total - 1)]
  const tituloRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (aberto) tituloRef.current?.focus?.()
  }, [aberto, passo])

  // Escape fecha (sem concluir — o carimbo só vai no "Concluir").
  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar()
      if (e.key === 'ArrowRight') proximo(total)
      if (e.key === 'ArrowLeft') anterior()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto, fechar, proximo, anterior, total])

  if (!aberto || !atual) return null
  if (typeof document === 'undefined') return null

  const ultimo = passo >= total - 1

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-slate-900/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Tour guiado do Aurum Tax NCM"
    >
      <div className="glass-box modal-box my-6 w-full max-w-2xl" role="document">
        {/* Cabeçalho nobre: marinho profundo + filete ouro */}
        <div className="relative overflow-hidden border-b border-[var(--line)]">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-br from-brand-900 via-brand-700 to-brand-950 dark:from-brand-950 dark:via-brand-900 dark:to-black"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-transparent via-aurum-400 to-transparent"
          />
          <div className="relative flex items-center gap-3 px-5 py-4 text-white">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-aurum-400/50 bg-white/10 text-2xl shadow-inner backdrop-blur">
              {atual.icone}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-aurum-200">
                Tour guiado · {passo + 1} de {total}
              </div>
              <h2 className="truncate text-base font-black tracking-tight">
                {atual.menu}
              </h2>
              <p className="truncate text-[11px] text-white/70">
                Menu por menu — o que faz e como usar
              </p>
            </div>
            <EscudoAurum tamanho={40} />
          </div>
          {/* progresso */}
          <div className="relative bg-black/20 px-5 pb-3 pt-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-aurum-300 via-aurum-400 to-aurum-200 transition-[width] duration-300"
                style={{ width: `${Math.round(((passo + 1) / total) * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Etapas do tour">
              {PASSOS_TOUR.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={i === passo}
                  title={p.menu}
                  onClick={() => irPasso(i)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition ${
                    i === passo
                      ? 'bg-aurum-400 text-brand-950'
                      : i < passo
                        ? 'bg-white/25 text-white hover:bg-white/35'
                        : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  {i + 1} · {p.menu}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div ref={tituloRef} tabIndex={-1} className="outline-none">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={passo}
              initial={reduzir ? { opacity: 0 } : { opacity: 0, x: 48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduzir ? { opacity: 0 } : { opacity: 0, x: -48 }}
              transition={reduzir ? { duration: 0.15 } : TRANSICAO}
              className="modal-scroll scroll-elegante min-h-[16rem] space-y-3 px-5 py-4 text-xs leading-relaxed"
            >
              <QuadroMenu passo={passo} reduzir={reduzir} irPasso={irPasso} />

              <p className="text-sm leading-relaxed">
                <strong>{atual.oQueFaz}</strong>
              </p>

              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                  Como usar
                </div>
                <ol className="list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                  {atual.comoUsar.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ol>
              </div>

              <div className="rounded-xl border border-aurum-500/40 bg-gradient-to-br from-aurum-50 to-white p-3 text-brand-800 dark:border-aurum-800 dark:from-brand-950/40 dark:to-slate-900 dark:text-aurum-200">
                <strong>✨ Dica:</strong> {atual.dica}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3">
          <button
            type="button"
            onClick={concluir}
            className="text-[11px] font-semibold text-slate-400 hover:text-brand-600"
          >
            Pular tour →
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={anterior} disabled={passo === 0}>
              ← Anterior
            </Btn>
            {ultimo ? (
              <Btn variante="primary" onClick={concluir}>
                ✓ Concluir tour
              </Btn>
            ) : (
              <Btn variante="primary" onClick={() => proximo(total)}>
                Próximo →
              </Btn>
            )}
          </div>
        </div>
        <p className="border-t border-[var(--line)] bg-slate-50 px-5 py-2 text-center text-[10px] text-slate-400 dark:bg-slate-950/40">
          Tela informativa — animação em loop, nada muda no sistema · ← → navega · Esc fecha · reabra no botão{' '}
          <strong>✨ Guia</strong> do topo
        </p>
      </div>
    </div>,
    document.body,
  )
}
