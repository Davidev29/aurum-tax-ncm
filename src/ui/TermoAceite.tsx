/**
 * Assistente de instalação local — primeira execução do Aurum Tax NCM.
 *
 * Wizard intuitivo em 5 passos (Cláusula Terceira do Contrato):
 *   1. Boas-vindas (o que é + 100% local sem nuvem + o que vou perguntar)
 *   2. Contrato e identificação (nome, CPF/CNPJ, e-mail + checkbox de aceite)
 *   3. Perfil de uso + primeira empresa (tudo opcional, pode pular)
 *   4. Emitente do relatório + aparência (tema)
 *   5. Revisão e conclusão (grava o aceite só na máquina)
 *
 * Nada é enviado à nuvem: o aceite fica em `localStorage`, a empresa/emitente
 * no banco local (IndexedDB) e o tema no `localStorage`.
 */
import { useState } from 'react'
import { Btn, Campo, Check, Selecao, Texto } from './kit'
import {
  ACEITE_KEY,
  CONTRATO_NOME_ARQUIVO,
  CONTRATO_VERSAO,
  TERMO_RESUMO,
  gravarAceite,
  validarContratante,
  type Contratante,
} from '@/domain/contrato'
import { TEMA_KEY } from '@/domain/constants'
import { useSessao } from '@/store/sessao'
import { toast } from '@/store/ui'

const PASSOS = ['Boas-vindas', 'Contrato', 'Sua empresa', 'Aparência', 'Pronto'] as const

const PERFIS = [
  { valor: 'escritorio', rotulo: '🧾 Escritório contábil — cuido de vários clientes' },
  { valor: 'empresa', rotulo: '🏭 Empresa — uso fiscal interno' },
  { valor: 'consultor', rotulo: '👤 Consultor / autônomo' },
  { valor: 'estudo', rotulo: '📚 Estudo / testes da Reforma' },
] as const

type TemaEscolha = 'light' | 'dark'

function aplicarTemaEscolhido(tema: TemaEscolha): void {
  try {
    document.documentElement.classList.toggle('dark', tema === 'dark')
    localStorage.setItem(TEMA_KEY, tema)
  } catch {
    /* tema volta ao padrão na próxima carga */
  }
}

export function AssistenteInstalacao({ onConcluido }: { onConcluido: () => void }) {
  const [passo, setPasso] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Passo 2 — quem contrata (prova da contratação, gravada só localmente).
  const [contratante, setContratante] = useState<Contratante>({ nome: '', documento: '', email: '' })
  const [aceitou, setAceitou] = useState(false)

  // Passo 3 — perfil + primeira empresa (opcional).
  const [perfil, setPerfil] = useState<string>('escritorio')
  const [empresaRazao, setEmpresaRazao] = useState('')
  const [empresaCnpj, setEmpresaCnpj] = useState('')

  // Passo 4 — emitente + tema.
  const [emitenteRazao, setEmitenteRazao] = useState('')
  const [tema, setTema] = useState<TemaEscolha>(() =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  )

  const campoContratante = <K extends keyof Contratante>(nome: K, valor: Contratante[K]) =>
    setContratante((c) => ({ ...c, [nome]: valor }))

  const avancarDoContrato = (): void => {
    const invalido = validarContratante(contratante)
    if (invalido) {
      setErro(invalido)
      return
    }
    if (!aceitou) {
      setErro('Marque a caixa “Li e Aceito” para prosseguir com a instalação.')
      return
    }
    setErro(null)
    // Pré-preenche a empresa/emitente com os dados do contratante.
    if (!empresaRazao && contratante.nome.trim()) setEmpresaRazao(contratante.nome.trim())
    if (!empresaCnpj && contratante.documento.trim()) setEmpresaCnpj(contratante.documento.trim())
    if (!emitenteRazao && contratante.nome.trim()) setEmitenteRazao(contratante.nome.trim())
    setPasso(2)
  }

  const concluir = async (): Promise<void> => {
    setSalvando(true)
    setErro(null)
    try {
      // 1. Aceite local (nunca sai da máquina).
      gravarAceite(
        {
          nome: contratante.nome.trim(),
          documento: contratante.documento.trim(),
          email: contratante.email.trim(),
        },
        perfil,
      )
      // 2. Tema escolhido aplicado na hora.
      aplicarTemaEscolhido(tema)
      // 3. Primeira empresa (opcional — falha não bloqueia).
      const razao = empresaRazao.trim()
      if (razao) {
        try {
          await useSessao.getState().criar({ razaoSocial: razao, cnpj: empresaCnpj.trim() })
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Não foi possível criar a empresa agora.', 'warn')
        }
      }
      // 4. Emitente do timbrado (opcional).
      const emit = emitenteRazao.trim()
      if (emit) {
        try {
          await useSessao.getState().persistirEmitente({ razaoSocial: emit })
        } catch {
          /* segue sem emitente — configurável depois em ⚙ */
        }
      }
      toast('Instalação concluída. Bom trabalho!', 'ok')
      onConcluido()
    } finally {
      setSalvando(false)
    }
  }

  const podeVoltar = passo > 0 && !salvando

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-slate-900/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Assistente de instalação do Aurum Tax NCM"
    >
      <div className="glass-box modal-box my-6 w-full max-w-2xl" role="document">
        <div className="glass-header border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-base font-black">🧭 Instalação — Aurum Tax NCM</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Passo {passo + 1} de {PASSOS.length}: {PASSOS[passo]} · Contrato v{CONTRATO_VERSAO}
          </p>
          <div
            className="mt-2 flex gap-1.5"
            role="progressbar"
            aria-valuenow={passo + 1}
            aria-valuemin={1}
            aria-valuemax={PASSOS.length}
          >
            {PASSOS.map((p, i) => (
              <span
                key={p}
                title={p}
                className={`h-1.5 flex-1 rounded-full transition ${
                  i <= passo ? 'bg-brand-600 dark:bg-aurum-400' : 'bg-slate-200 dark:bg-slate-700'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="modal-scroll scroll-elegante min-h-[16rem] px-5 py-4 text-xs leading-relaxed">
          {passo === 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-bold">
                Bem-vindo! Vamos deixar tudo pronto em menos de 1 minuto. 👋
              </p>
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                <strong>🔒 100% local, sem nuvem.</strong> Empresas, produtos, XMLs e
                classificações ficam <strong>somente neste computador</strong> (banco local + pasta
                de dados). A Aurum <strong>não recebe nem tem acesso</strong> à sua base. Internet
                só é usada se você pedir: buscar CNPJ, ler a lei oficial ou baixar atualizações.
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
                <strong>Vou te perguntar só o essencial:</strong>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                  <li>Seu nome, CPF/CNPJ e e-mail + aceite do contrato;</li>
                  <li>Seu perfil e a primeira empresa (pode pular);</li>
                  <li>Nome do timbrado dos relatórios e tema claro/escuro.</li>
                </ol>
              </div>
              <p className="text-[11px] text-slate-400">
                Classificador fiscal da Reforma Tributária: NCM/NBS, CST de IBS/CBS, cClassTrib
                e XML — base EC 132/2023 · LC 214/2025 · Decreto 12.955/2026 · Res. CGIBS
                6/2026.
              </p>
            </div>
          ) : null}

          {passo === 1 ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-aurum-900 dark:bg-brand-950/30">
                <strong>📜 Contrato de Licença Desktop (resumo).</strong>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                  {TERMO_RESUMO.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ol>
                <p className="mt-2 text-[11px] text-slate-400">
                  Texto integral em <code>docs/{CONTRATO_NOME_ARQUIVO}</code> e no arquivo{' '}
                  <code>LICENCA.txt</code> do instalador — ele prevalece sobre este resumo.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Campo label="Seu nome / razão social" obrigatorio className="sm:col-span-2">
                  <Texto
                    value={contratante.nome}
                    onChange={(e) => campoContratante('nome', e.target.value)}
                    placeholder="Ex.: Escritório Modelo LTDA"
                    autoComplete="organization"
                  />
                </Campo>
                <Campo label="CPF ou CNPJ" obrigatorio>
                  <Texto
                    mask="cnpj"
                    mono
                    value={contratante.documento}
                    onChange={(e) => campoContratante('documento', e.target.value)}
                    placeholder="00.000.000/0000-00"
                    inputMode="numeric"
                  />
                </Campo>
                <Campo label="E-mail" obrigatorio>
                  <Texto
                    value={contratante.email}
                    onChange={(e) => campoContratante('email', e.target.value)}
                    placeholder="voce@escritorio.com.br"
                    inputMode="email"
                    autoComplete="email"
                  />
                </Campo>
              </div>
              <Check
                label="Li o Contrato de Licença (resumo acima + texto integral em docs/LICENCA.txt) e ACEITO os seus termos."
                checked={aceitou}
                onChange={(e) => {
                  setAceitou(e.target.checked)
                  if (e.target.checked) setErro(null)
                }}
              />
            </div>
          ) : null}

          {passo === 2 ? (
            <div className="space-y-3">
              <Campo label="Como você vai usar o Aurum Tax NCM?">
                <Selecao value={perfil} onChange={(e) => setPerfil(e.target.value)}>
                  {PERFIS.map((p) => (
                    <option key={p.valor} value={p.valor}>
                      {p.rotulo}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
                <strong>🏢 Primeira empresa (opcional).</strong>
                <p className="mb-2 text-[11px] text-slate-400">
                  Organiza produtos e notas por cliente. Dá para pular e cadastrar depois em{' '}
                  <strong>Empresas</strong>.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Campo label="Razão social da empresa">
                    <Texto
                      value={empresaRazao}
                      onChange={(e) => setEmpresaRazao(e.target.value)}
                      placeholder="Ex.: Cliente Modelo LTDA"
                    />
                  </Campo>
                  <Campo label="CNPJ da empresa">
                    <Texto
                      mask="cnpj"
                      mono
                      value={empresaCnpj}
                      onChange={(e) => setEmpresaCnpj(e.target.value)}
                      placeholder="00.000.000/0000-00"
                      inputMode="numeric"
                    />
                  </Campo>
                </div>
              </div>
            </div>
          ) : null}

          {passo === 3 ? (
            <div className="space-y-3">
              <Campo label="Nome no timbrado dos relatórios (PDF)">
                <Texto
                  value={emitenteRazao}
                  onChange={(e) => setEmitenteRazao(e.target.value)}
                  placeholder="Ex.: Escritório Modelo LTDA"
                />
              </Campo>
              <div>
                <span className="field-label">Aparência</span>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(
                    [
                      ['light', '☀️ Claro', 'Fundo branco, ideal para o dia'],
                      ['dark', '🌙 Escuro', 'Fundo escuro, descansa a vista'],
                    ] as Array<[TemaEscolha, string, string]>
                  ).map(([valor, titulo, dica]) => (
                    <button
                      key={valor}
                      type="button"
                      onClick={() => setTema(valor)}
                      aria-pressed={tema === valor}
                      className={`rounded-xl border p-3 text-left transition ${
                        tema === valor
                          ? 'border-brand-500 bg-brand-50/70 dark:border-aurum-500 dark:bg-brand-900/20'
                          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                      }`}
                    >
                      <div className="text-sm font-bold">{titulo}</div>
                      <div className="text-[11px] text-slate-400">{dica}</div>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Dá para trocar depois no ☀/◐ do topo.
                </p>
              </div>
            </div>
          ) : null}

          {passo === 4 ? (
            <div className="space-y-3">
              <p className="text-sm font-bold">✅ Tudo certo, {contratante.nome.split(' ')[0] || 'vamos lá'}! Confira:</p>
              <dl className="space-y-1.5 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Contratante</dt>
                  <dd className="text-right font-semibold">
                    {contratante.nome} · {contratante.documento}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">E-mail</dt>
                  <dd className="font-semibold">{contratante.email}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Perfil</dt>
                  <dd className="font-semibold">
                    {PERFIS.find((p) => p.valor === perfil)?.rotulo ?? perfil}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Empresa inicial</dt>
                  <dd className="font-semibold">{empresaRazao.trim() || '— (cadastrar depois)'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Timbrado / tema</dt>
                  <dd className="font-semibold">
                    {emitenteRazao.trim() || '—'} · {tema === 'dark' ? 'escuro' : 'claro'}
                  </dd>
                </div>
              </dl>
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                Ao concluir, gravo o aceite (contrato v{CONTRATO_VERSAO} + data/hora){' '}
                <strong>só nesta máquina</strong> (chave <code>{ACEITE_KEY}</code>). Sem nuvem, sem
                conta, sem telemetria da sua base.
              </div>
            </div>
          ) : null}

          {erro ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {erro}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3">
          <Btn variante="ghost" onClick={() => (podeVoltar ? setPasso(passo - 1) : undefined)}>
            ← Voltar
          </Btn>
          {passo < 4 ? (
            <Btn
              variante="primary"
              onClick={() => {
                if (passo === 0) {
                  setErro(null)
                  setPasso(1)
                } else if (passo === 1) {
                  avancarDoContrato()
                } else {
                  setErro(null)
                  setPasso(passo + 1)
                }
              }}
            >
              {passo === 0 ? 'Começar →' : 'Continuar →'}
            </Btn>
          ) : (
            <Btn variante="primary" onClick={() => void concluir()}>
              {salvando ? '⏳ Salvando…' : '✓ Concluir instalação'}
            </Btn>
          )}
        </div>
      </div>
    </div>
  )
}

/** Nome antigo do portão simples — mantido como apelido do wizard. */
export const PortaoAceite = AssistenteInstalacao
