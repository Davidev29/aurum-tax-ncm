/**
 * build-base.mjs
 * ==============
 * Compila as bases oficiais da Reforma Tributária em artefatos normalizados,
 * prontos para serem embutidos no aplicativo.
 *
 * COMO ATUALIZAR (sem IA):
 *   1. Jogue os JSONs oficiais dentro de `bases-fonte/` (pasta do projeto):
 *   2. Rode `npm run base` — este script recompila `public/base/`
 *   3. Rode `npm run dist:win` e publique o Release no GitHub
 *
 * ENTRADAS (ordem de procura — primeira que tiver os arquivos vence):
 *   1. `AURUM_BASE_DIR` (se a variável de ambiente estiver definida)
 *   2. `bases-fonte/` (pasta oficial dentro do projeto — USE ESTA)
 *   3. pasta pai do projeto (legado: `C:\...\REFORMA NCM\*.json`)
 *
 *   - classificacao_tributaria.json       -> referência CST x cClassTrib (164 registros)
 *   - reforma_tributaria_por_ncm.json     -> vinculos NCM/NBS + tabelas CST/cClassTrib
 *   - Tabela_NCM_Vigente_*.json           -> nomenclatura NCM vigente
 *   - CNAE X ANEXO.json                   -> (Phase 7, vivo/opcional) CNAE × Anexo Simples + Fator R
 *   - NBS SERVIÇOS.json                   -> (Phase 7, vivo/opcional) vínculos NBS (prefere ao legado)
 *
 * SAÍDA (public/base/):
 *   - classificacao-tributaria.json  referência normalizada (chave: cClassTrib)
 *   - reforma.json                   CST + cClassTrib + vinculos NCM/NBS
 *   - nomenclatura.json              nomenclatura vigente (auto-preenchimento)
 *   - cnae.json                      CNAE × Anexo Simples (Phase 7)
 *   - MANIFEST.json                  metadados, contagens e checksums (+fontesVivas)
 *
 * Por que normalizar?
 *   O JSON de origem tem 16 MB porque repete a mesma referencia (2,5 KB) em cada
 *   um dos 2.345 NCM. Ao normalizar (3FN) o mesmo conteudo cai para ~1,5 MB e a
 *   aplicacao carrega com um unico JOIN em memoria, sem perda de informacao.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
/** Pasta oficial das fontes dentro do projeto — é aqui que o Davi atualiza. */
const DIR_FONTE_PROJETO = path.join(PROJECT_ROOT, 'bases-fonte');
/** Pasta legada (arquivos soltos na pasta pai `REFORMA NCM\`). Mantida por compatibilidade. */
const DIR_FONTE_LEGADO = path.join(PROJECT_ROOT, '..');
/** Ordem de procura: env > projeto > legado. */
const DIRS_FONTES = [
  ...(process.env.AURUM_BASE_DIR ? [path.resolve(process.env.AURUM_BASE_DIR)] : []),
  DIR_FONTE_PROJETO,
  DIR_FONTE_LEGADO,
];
const OUT_DIR = path.join(PROJECT_ROOT, 'public', 'base');

const SCHEMA_VERSION = 1;

/** Chave canonica de documento fiscal -> ordem de exibicao. */
export const DOC_KEYS = [
  'NFe', 'NFCe', 'CTe', 'CTeOS', 'BPe', 'BPeTM',
  'NF3e', 'NFCom', 'NFSe', 'BPeTA', 'NFAg', 'NFSVIA',
  'NFABI', 'NFGas', 'DERE', 'DIR', 'DUIMP',
];

const DOC_ALIASES = {
  NFe: 'NFe', NFCe: 'NFCe', CTe: 'CTe', 'CTe OS': 'CTeOS', CTeOS: 'CTeOS',
  BPe: 'BPe', 'BPe TM': 'BPeTM', BPeTM: 'BPeTM', NF3e: 'NF3e', NFCom: 'NFCom',
  NFSe: 'NFSe', NFSE: 'NFSe', 'BPe TA': 'BPeTA', BPeTA: 'BPeTA',
  NFAg: 'NFAg', NFSVIA: 'NFSVIA', NFABI: 'NFABI', NFGas: 'NFGas',
  DERE: 'DERE', DIR: 'DIR', DUIMP: 'DUIMP',
};

// ---------------------------------------------------------------------------
// Helpers de normalização
// ---------------------------------------------------------------------------

/** "Sim"/"Não"/1/0/"1"/true -> boolean */
export const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'sim' || s === '1' || s === 'true' || s === 's';
};

/** Extrai apenas dígitos (preserva zeros à esquerda). */
export const digits = (v) => String(v ?? '').replace(/\D+/g, '');

/** Normaliza para número, ou null quando vazio/não numérico. */
export const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** 3 dígitos para CST. */
export const padCst = (v) => {
  const d = digits(v);
  if (!d) return null;
  return d.padStart(3, '0').slice(-3);
};

/** 6 dígitos para cClassTrib. */
export const padCct = (v) => {
  const d = digits(v);
  if (!d) return null;
  return d.padStart(6, '0').slice(-6);
};

/** Monta o rótulo do ato legal: "Res Gecex 272/2021". */
export const montarAto = (item) => {
  const tipo = String(item?.Tipo_Ato_Ini ?? '').trim();
  if (!tipo) return null;
  const numero = String(item?.Numero_Ato_Ini ?? '').trim();
  const ano = String(item?.Ano_Ato_Ini ?? '').trim();
  return [tipo, [numero, ano].filter(Boolean).join('/')].filter(Boolean).join(' ').trim() || null;
};

/** Ato de extinção ("negado" na vigente): "Res Gecex 926/2026". */
export const montarAtoFim = (item) => {
  const tipo = String(item?.Tipo_Ato_Fim ?? item?.atoFim ?? '').trim();
  if (!tipo) return typeof item?.atoFim === 'string' && item.atoFim.trim() ? item.atoFim.trim() : null;
  const numero = String(item?.Numero_Ato_Fim ?? '').trim();
  const ano = String(item?.Ano_Ato_Fim ?? '').trim();
  return [tipo, [numero, ano].filter(Boolean).join('/')].filter(Boolean).join(' ').trim() || null;
};

/** Converte o mapa {NFe:true,...} completo, sempre com todas as chaves canônicas. */
const buildDocs = (registro, extrator) => {
  const docs = {};
  for (const key of DOC_KEYS) docs[key] = false;
  if (registro) {
    for (const [rawKey, rawVal] of Object.entries(registro)) {
      const canon = DOC_ALIASES[rawKey] ?? (extrator ? extrator(rawKey) : null);
      if (canon && canon in docs) docs[canon] = toBool(rawVal);
    }
  }
  return docs;
};

/** Extrai {NFe:true,...} a partir dos campos "indXXX" da tabela CST. */
const docsDaTabelaCst = (registro) => ({
  NFe: registro.indNFe, NFCe: registro.indNFCe, CTe: registro.indCTe,
  CTeOS: registro.indCteOS, BPe: registro.indBPe, BPeTM: registro.indBPeTM,
  NF3e: registro.indNF3e, NFCom: registro.indNFCom, NFSe: registro.indNFSe,
});

const lerJson = (caminho) => {
  if (!fs.existsSync(caminho)) return null;
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
};

const localizar = (padrao) => {
  for (const dir of DIRS_FONTES) {
    if (!fs.existsSync(dir)) continue;
    const achado = fs.readdirSync(dir).find((f) => new RegExp(padrao).test(f));
    if (achado) return path.join(dir, achado);
  }
  return null;
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------------------
// 1) Referência: classificacao_tributaria.json
// ---------------------------------------------------------------------------

export function normalizarReferencia(bruto) {
  if (!Array.isArray(bruto)) throw new Error('classificacao_tributaria.json deve ser um array.');
  return bruto.map((r) => ({
    cst: padCst(r['Código da Situação Tributária']),
    cstDescricao: String(r['Descrição da Situação Tributária'] ?? '').trim(),
    cClassTrib: padCct(r['Código da Classificação Tributária']),
    descricao: String(r['Descrição do Código da Classificação Tributária'] ?? '').trim(),
    pRedIBS: toNum(r['Percentual Redução IBS']) ?? 0,
    pRedCBS: toNum(r['Percentual Redução CBS']) ?? 0,
    tipoAliquota: String(r['Tipo de Alíquota'] ?? '').trim() || null,
    anexo: String(r['Número do Anexo'] ?? '').trim() || null,
    urlLegislacao: String(r['Url da Legislação'] ?? '').trim() || null,
    exigeTributacao: toBool(r['Exige Tributação']),
    reducaoBC: toBool(r['Redução BC CST']),
    reducaoAliquota: toBool(r['Redução de Alíquota']),
    transferenciaCredito: toBool(r['Transferência de Crédito']),
    diferimento: toBool(r['Diferimento']),
    monofasica: toBool(r['Monofásica']),
    creditoPresumidoZFM: toBool(r['Crédito Presumido IBS Zona Franca de Manaus']),
    ajusteCompetencia: toBool(r['Ajuste de Competência']),
    tributacaoRegular: toBool(r['Tributação Regular']),
    creditoPresumido: toBool(r['Crédito Presumido']),
    estornoCredito: toBool(r['Estorno de Crédito']),
    monoNormal: toBool(r['Tributação Monofásica Normal']),
    monoRetencao: toBool(r['Tributação Monofásica sujeita a retenção']),
    monoRetida: toBool(r['Tributação Monofásica retida anteriormente']),
    monoDiferimentoCombustivel: toBool(r['Tributação Monofásica de Combustível com diferimento']),
    simplesReceitaBruta: String(r['Tipo de Receita Bruta do Simples Nacional'] ?? '').trim() || null,
    regimeContribuicaoSocial: String(r['Regime de Contribuição Social sobre Bens e Serviços'] ?? '').trim() || null,
    impostoBensServicos: String(r['Imposto sobre Bens e Serviços'] ?? '').trim() || null,
    docs: buildDocs(r, null),
  })).map((r) => ({ ...r, id: `${r.cst}|${r.cClassTrib}` })).filter((r) => r.cst && r.cClassTrib);
}

// ---------------------------------------------------------------------------
// 2) Reforma: CST + cClassTrib + vínculos NCM/NBS
// ---------------------------------------------------------------------------

export function normalizarCst(bruto) {
  return (bruto ?? []).map((c) => ({
    codigo: padCst(c['CST-IBS/CBS']),
    descricao: String(c['Descrição CST-IBS/CBS'] ?? '').trim(),
    indIBSCBS: toBool(c.ind_gIBSCBS),
    indIBSCBSMono: toBool(c.ind_gIBSCBSMono),
    indReducao: toBool(c.ind_gRed),
    indDiferimento: toBool(c.ind_gDif),
    indTransferenciaCredito: toBool(c.ind_gTransfCred),
    docs: buildDocs(docsDaTabelaCst(c), null),
  })).filter((c) => c.codigo);
}

export function normalizarCstClassTrib(bruto) {
  return (bruto ?? []).map((c) => {
    const cst = padCst(c['CST-IBS/CBS']);
    const cct = padCct(c.cClassTrib);
    return {
      id: `${cst}|${cct}`,
      cst,
      cClassTrib: cct,
      nome: String(c['Nome cClassTrib'] ?? '').trim(),
      descricao: String(c['Descrição cClassTrib'] ?? '').trim(),
      lcRedacao: String(c['LC Redação'] ?? '').trim() || null,
      lcRef: String(c['LC 214/25'] ?? '').trim() || null,
      tipoAliquota: String(c['Tipo de Alíquota'] ?? '').trim() || null,
      pRedIBS: toNum(c.pRedIBS),
      pRedCBS: toNum(c.pRedCBS),
      indRedutorBC: toNum(c.ind_RedutorBC),
      indTribRegular: toNum(c.ind_gTribRegular),
      indCredPres: toNum(c.ind_CredPres),
      indMono: toNum(c.indMono),
      indMonoReten: toNum(c.indMonoReten),
      indMonoRet: toNum(c.indMonoRet),
      indMonoDif: toNum(c.indMonoDif),
      creditoPara: String(c['Crédito para'] ?? '').trim() || null,
      inicioVigencia: String(c.dIniVig ?? '').trim() || null,
      fimVigencia: String(c.dFimVig ?? '').trim() || null,
      atualizadoEm: String(c.DataAtualização ?? '').trim() || null,
    };
  }).filter((c) => c.cst && c.cClassTrib);
}

export function normalizarNcm(bruto) {
  return (bruto ?? []).map((n, i) => ({
    id: `${digits(n.codigo)}|${padCct(n.cClassTrib) ?? ''}|${i}`,
    codigo: digits(n.codigo),
    codigoFormatado: fmtNcm(digits(n.codigo)),
    cst: padCst(n.cst) ?? '',
    cClassTrib: padCct(n.cClassTrib) ?? '',
    baseLegal: String(n.baseLegal ?? '').trim(),
    reducao: toNum(n.reducao),
    aliquotaIBS: toNum(n.aliquotaIBS),
    aliquotaCBS: toNum(n.aliquotaCBS),
    documentos: String(n.documentosFiscaisRelacionados ?? '').trim(),
    descricao: String(n.descricaoCompleta ?? '').trim(),
  })).filter((n) => n.codigo.length === 8);
}

/** `AAAA.BB.CC` somente para 8 dígitos (paridade com a aplicação). */
const fmtNcm = (d) => (d.length === 8 ? `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}` : d);

export function normalizarNbs(bruto) {
  return (bruto ?? []).map((n, i) => ({
    id: `${digits(n.codigo)}|${i}`,
    codigo: digits(n.codigo),
    cst: padCst(n.cst) ?? '',
    cClassTrib: padCct(n.cClassTrib) ?? '',
    baseLegal: String(n.baseLegal ?? '').trim(),
    reducao: toNum(n.reducao),
    aliquotaIBS: toNum(n.aliquotaIBS),
    aliquotaCBS: toNum(n.aliquotaCBS),
    descricao: String(n.descricaoCompleta ?? '').trim(),
    documentos: String(n.documentosFiscaisRelacionados ?? n.documentos ?? '').trim(),
  })).filter((n) => n.codigo.length === 9);
}

/** `0111301` → `0111-3/01` (máscara oficial do CNAE). */
export const fmtCnae = (d) => (d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5, 7)}` : d);

/** `"III / V"` → `['III','V']`; `"Não aplicável"` descartado. */
export function normalizarAnexosSimples(v) {
  return String(v ?? '')
    .split('/')
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p && p !== 'NÃO APLICÁVEL' && p !== 'NAO APLICAVEL');
}

const SITUACOES_CNAE = ['Permitido', 'Permitido com ressalvas', 'Depende da atividade'];

const ehSim = (v) => ['sim', 's', '1', 'true'].includes(String(v ?? '').trim().toLowerCase());

/**
 * Phase 7 — `CNAE X ANEXO.json` (array plano, chaves PT acentuadas) ou o
 * artefato `cnae.json` (`{ itens }`). Dedupe por `codigo7`.
 */
export function normalizarCnaeAnexo(bruto) {
  const lista = Array.isArray(bruto) ? bruto : (bruto?.itens ?? []);
  const vistos = new Set();
  const out = [];
  for (const raw of (lista ?? [])) {
    if (!raw || typeof raw !== 'object') continue;
    const codigo7 = digits(raw['CNAE'] ?? raw.codigo7 ?? raw.codigoFormatado ?? '');
    if (codigo7.length !== 7 || vistos.has(codigo7)) continue;
    vistos.add(codigo7);
    const sit = String(raw['Situação'] ?? raw.situacao ?? '').trim();
    out.push({
      codigo7,
      codigoFormatado: fmtCnae(codigo7),
      descricao: String(raw['Descrição oficial'] ?? raw.descricao ?? '').trim(),
      situacao: SITUACOES_CNAE.find((x) => x.toLowerCase() === sit.toLowerCase()) ?? 'Depende da atividade',
      anexos: normalizarAnexosSimples(raw['Anexos'] ?? raw.anexos ?? ''),
      fatorR: ehSim(raw['Fator R'] ?? raw.fatorR),
    });
  }
  return out;
}

/**
 * Phase 7 — `NBS SERVIÇOS.json` (array plano, chaves PT acentuadas) para o
 * shape canônico de vínculo NBS, com dedupe por `codigo|cst|cClassTrib`
 * (o arquivo vivo contém ~30 linhas repetidas). `Aliq. IBS/CBS` são
 * preservadas como dado de origem/auditoria — o cálculo usa
 * `calcularTributos` + `REF_DEFAULT`.
 */
export function normalizarNbsServicos(bruto) {
  const lista = Array.isArray(bruto) ? bruto : [];
  const vistos = new Set();
  const vinculos = [];
  let duplicados = 0;
  lista.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const codigo = digits(raw['NBS'] ?? raw.codigo ?? '');
    if (codigo.length !== 9) return;
    const cst = padCst(raw['CST'] ?? raw.cst) ?? '';
    const cct = padCct(raw['CclassTrib'] ?? raw.cClassTrib) ?? '';
    const chave = `${codigo}|${cst}|${cct}`;
    if (vistos.has(chave)) {
      duplicados++;
      return;
    }
    vistos.add(chave);
    vinculos.push({
      id: `${codigo}|${cct}|${i}`,
      codigo,
      cst,
      cClassTrib: cct,
      baseLegal: String(raw['Base Legal'] ?? raw.baseLegal ?? '').trim(),
      reducao: toNum(raw['Redução'] ?? raw.reducao),
      aliquotaIBS: toNum(raw['Aliq. IBS'] ?? raw.aliquotaIBS),
      aliquotaCBS: toNum(raw['Aliq. CBS'] ?? raw.aliquotaCBS),
      descricao: String(raw['Descrição completa'] ?? raw.descricao ?? '').trim(),
      documentos: String(raw['DFes Relac.'] ?? raw.documentos ?? '').trim(),
    });
  });
  return { vinculos, duplicados };
}

// ---------------------------------------------------------------------------
// 3) Nomenclatura vigente
// ---------------------------------------------------------------------------

export function normalizarNomenclatura(bruto) {
  const itens = bruto?.Nomenclaturas ?? bruto?.itens ?? [];
  return itens.map((n) => {
    const original = String(n.Codigo ?? n.codigoOriginal ?? '').trim();
    return {
      codigo: digits(original),
      codigoOriginal: original,
      descricao: String(n.Descricao ?? n.descricao ?? '').trim(),
      dataInicio: n.Data_Inicio ?? n.dataInicio ?? null,
      dataFim: (n.Data_Fim ?? n.dataFim) && (n.Data_Fim ?? n.dataFim) !== '31/12/9999' ? (n.Data_Fim ?? n.dataFim) : null,
      ato: montarAto(n) ?? (typeof n.ato === 'string' && n.ato.trim() ? n.ato.trim() : null),
      atoFim: montarAtoFim(n),
    };
  }).filter((n) => n.codigo.length >= 2);
}

// ---------------------------------------------------------------------------
// Códigos descartados pela normalização (rastreabilidade do MANIFEST)
// ---------------------------------------------------------------------------

function coletarIgnorados(refReforma, refNomen) {
  const ignorados = [];

  const varrer = (lista, esperado, origem) => {
    (lista ?? []).forEach((item, idx) => {
      const bruto = String(item?.codigo ?? item?.Codigo ?? '').trim();
      const dig = digits(bruto);
      if (!dig) {
        ignorados.push({ origem, indice: idx, codigo: bruto || '(vazio)', motivo: 'código vazio' });
      } else if (dig.length !== esperado) {
        ignorados.push({
          origem,
          indice: idx,
          codigo: bruto,
          motivo: `${dig.length} dígitos (esperado ${esperado})`,
        });
      }
    });
  };

  varrer(refReforma.NCM, 8, 'NCM');
  varrer(refReforma.NBS, 9, 'NBS');

  (refNomen?.Nomenclaturas ?? []).forEach((item, idx) => {
    const bruto = String(item?.Codigo ?? '').trim();
    const dig = digits(bruto);
    if (dig.length < 2) {
      ignorados.push({ origem: 'Nomenclatura', indice: idx, codigo: bruto || '(vazio)', motivo: 'código com menos de 2 dígitos' });
    }
  });

  return ignorados;
}

// ---------------------------------------------------------------------------
// Validações cruzadas (paridade com a base de origem)
// ---------------------------------------------------------------------------

function validar(referencia, cst, cstClassTrib, ncm, nomenclatura, ignorados = [], extras = {}) {
  const problemas = [];
  const cctRef = new Set(referencia.map((r) => r.cClassTrib));
  const cctTabela = new Set(cstClassTrib.map((c) => `${c.cst}|${c.cClassTrib}`));
  const cstCodigos = new Set(cst.map((c) => c.codigo));
  const nomenCodigos = new Set(nomenclatura.map((n) => n.codigo));

  const semRef = ncm.filter((n) => !cctRef.has(n.cClassTrib));
  const semCst = ncm.filter((n) => !cstCodigos.has(n.cst));
  const semPar = ncm.filter((n) => !cctTabela.has(`${n.cst}|${n.cClassTrib}`));
  const semNomen = ncm.filter((n) => !nomenCodigos.has(n.codigo));
  const duplicados = ncm.length - new Set(ncm.map((n) => `${n.codigo}|${n.cst}|${n.cClassTrib}`)).size;

  if (semRef.length) problemas.push(`${semRef.length} NCM sem correspondência na referência cClassTrib (ex.: ${semRef[0].cClassTrib})`);
  if (semCst.length) problemas.push(`${semCst.length} NCM apontam CST inexistente (ex.: ${semCst[0].cst})`);
  if (semPar.length) problemas.push(`${semPar.length} NCM sem par CST×cClassTrib na tabela auxiliar (ex.: ${semPar[0].cst}|${semPar[0].cClassTrib})`);
  if (semNomen.length) problemas.push(`${semNomen.length} NCM ausentes da nomenclatura vigente (ex.: ${semNomen[0].codigo})`);
  if (duplicados) problemas.push(`${duplicados} vínculos NCM duplicados`);
  if (ignorados.length) problemas.push(`${ignorados.length} códigos descartados na normalização (ex.: ${ignorados[0].codigo} — ${ignorados[0].motivo})`);

  return {
    problemas,
    ignorados,
    estatisticas: {
      referencia: referencia.length,
      cst: cst.length,
      cstClassTrib: cstClassTrib.length,
      ncm: ncm.length,
      nomenclatura: nomenclatura.length,
      ncmSemReferencia: semRef.length,
      ncmSemNomenclatura: semNomen.length,
      ncmDuplicados: duplicados,
      codigosIgnorados: ignorados.length,
      ...(extras.estatisticas ?? {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

function escrever(nome, dados) {
  const buf = Buffer.from(JSON.stringify(dados), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, nome), buf);
  return { arquivo: nome, bytes: buf.length, sha256: sha256(buf) };
}

// ---------------------------------------------------------------------------
// Gatilho 06-03/IA-03: rebuild do índice IA se a base tributária mudou
// ---------------------------------------------------------------------------
// Compara o hash SEMÂNTICO do MANIFEST (contagens + sha256 dos artefatos,
// ignorando `geradoEm`) com `recursos-ia/indice-ncm/.manifest-hash`. Se
// divergir, regenera via `scripts/gerar-indice-ia.mjs`. NUNCA falha o build
// da base: qualquer problema aqui vira aviso e o build segue exit 0.

async function gatilhoIndiceIA(manifest, arquivosSaida) {
  try {
    const INDICE_DIR = path.join(PROJECT_ROOT, 'recursos-ia', 'indice-ncm');
    const HASH_FILE = path.join(INDICE_DIR, '.manifest-hash');
    const GERADOR = path.join(PROJECT_ROOT, 'scripts', 'gerar-indice-ia.mjs');
    const BASE_IA = path.join(PROJECT_ROOT, 'recursos-ia', 'dados-brutos', 'ncm-para-ia.json');

    let hashAtual = null;
    try {
      const { calcularHashManifest } = await import('./gerar-indice-ia.mjs');
      hashAtual = calcularHashManifest(OUT_DIR);
    } catch {
      console.log('   índice IA: gerador 06-03 ilegível — gatilho ignorado.');
      return;
    }
    if (!hashAtual) {
      console.log('   índice IA: MANIFEST ilegível — gatilho ignorado.');
      return;
    }

    const anterior = fs.existsSync(HASH_FILE) ? fs.readFileSync(HASH_FILE, 'utf8').trim() : null;
    if (anterior === hashAtual) {
      console.log('   índice IA: em dia (hash MANIFEST inalterado) — rebuild ignorado.');
      return;
    }
    if (!fs.existsSync(GERADOR) || !fs.existsSync(BASE_IA)) {
      console.log('   índice IA: gerador ou base 06-02 ausente — gatilho ignorado (rode 06-02/06-03).');
      return;
    }
    console.log('   índice IA: MANIFEST mudou — regenerando índice...');
    execFileSync(process.execPath, [GERADOR], { stdio: 'inherit', cwd: PROJECT_ROOT });
    fs.mkdirSync(INDICE_DIR, { recursive: true });
    fs.writeFileSync(HASH_FILE, hashAtual + '\n');
    console.log('   índice IA: rebuild OK.');
  } catch (err) {
    console.log(`   índice IA: gatilho ignorado (${String(err.message).split('\n')[0]}). Build da base preservado.`);
  }
}

async function main() {
  console.log(' Aurum Tax NCM — compilação da base tributária');
  console.log(`   procura em: ${DIRS_FONTES.join('  |  ')}`);

  const arquivos = {
    referencia: localizar('^classificacao_tributaria\\.json$'),
    reforma: localizar('^reforma_tributaria_por_ncm\\.json$'),
    nomenclatura: localizar('^Tabela_NCM_Vigente_.*\\.json$'),
    // Phase 7 — arquivos vivos de Serviços (preferência sobre o legado).
    cnae: localizar('^CNAE X ANEXO\\.json$'),
    nbsServicos: localizar('^NBS SERVIÇOS\\.json$'),
  };

  const ausentes = Object.entries({ referencia: arquivos.referencia, reforma: arquivos.reforma, nomenclatura: arquivos.nomenclatura }).filter(([, v]) => !v).map(([k]) => k);
  // Phase 7 — arquivos vivos são OPCIONAIS: sem eles, NBS cai no legado e
  // CNAE nasce vazio (a base embutida segue válida para NCM).
  const vivosAusentes = ['cnae', 'nbsServicos'].filter((k) => !arquivos[k]);
  if (ausentes.length) {
    // Tolera fontes ausentes quando a saída versionada já existe: `public/base/`
    // é commitado no repo, então `npm run build`/`dist` funciona em qualquer
    // máquina com só `git clone + npm ci` (sem os JSONs brutos).
    const saidasVersionadas = ['classificacao-tributaria.json', 'reforma.json', 'nomenclatura.json', 'MANIFEST.json'];
    const saidasOk = saidasVersionadas.every((f) => fs.existsSync(path.join(OUT_DIR, f)));
    if (saidasOk) {
      console.warn(`\n⚠ Fontes ausentes (${ausentes.join(', ')}) — usando public/base/ versionado.`);
      console.warn('  Para atualizar: jogue os 3 JSONs em bases-fonte/ e rode `npm run base`.');
      return;
    }
    console.error(`\n✖ Arquivos de origem ausentes: ${ausentes.join(', ')}`);
    console.error('  Jogue os 3 JSONs em Aurum Tax NCM/bases-fonte/ e rode `npm run base`.');
    process.exit(1);
  }

  const origemEfetiva = path.dirname(arquivos.referencia);
  console.log(`   origem efetiva: ${origemEfetiva}`);
  console.log(`   referencia : ${path.basename(arquivos.referencia)}`);
  console.log(`   reforma     : ${path.basename(arquivos.reforma)}`);
  console.log(`   nomenclatura: ${path.basename(arquivos.nomenclatura)}`);
  console.log(`   cnae        : ${arquivos.cnae ? path.basename(arquivos.cnae) : '(ausente — store CNAE vazia)'}`);
  console.log(`   nbsServicos : ${arquivos.nbsServicos ? path.basename(arquivos.nbsServicos) : '(ausente — NBS do legado)'}`);
  if (vivosAusentes.length) console.log(`   vivos ausentes: ${vivosAusentes.join(', ')} (tolerado)`);

  const t0 = Date.now();
  const refBruta = lerJson(arquivos.referencia);
  const refReforma = lerJson(arquivos.reforma);
  const refNomen = lerJson(arquivos.nomenclatura);
  const refCnae = arquivos.cnae ? lerJson(arquivos.cnae) : [];
  const refNbsVivo = arquivos.nbsServicos ? lerJson(arquivos.nbsServicos) : null;

  const referencia = normalizarReferencia(refBruta);
  const cst = normalizarCst(refReforma.tabelasAuxiliares?.cst);
  const cstClassTrib = normalizarCstClassTrib(refReforma.tabelasAuxiliares?.cstClassTrib);
  const ncm = normalizarNcm(refReforma.NCM);
  // Phase 7 — NBS prefere o arquivo vivo (dedupe); legado como fallback.
  const nbsVivo = refNbsVivo ? normalizarNbsServicos(refNbsVivo) : { vinculos: normalizarNbs(refReforma.NBS), duplicados: 0 };
  const nbs = nbsVivo.vinculos;
  const cnae = normalizarCnaeAnexo(refCnae);
  const nomenclatura = normalizarNomenclatura(refNomen);

  const ignorados = coletarIgnorados(refReforma, refNomen);
  const { problemas, estatisticas } = validar(referencia, cst, cstClassTrib, ncm, nomenclatura, ignorados, {
    estatisticas: {
      cnae: cnae.length,
      nbsServicos: nbs.length,
      nbsDuplicados: nbsVivo.duplicados,
      fontesVivas: {
        cnae: arquivos.cnae ? path.basename(arquivos.cnae) : null,
        nbsServicos: arquivos.nbsServicos ? path.basename(arquivos.nbsServicos) : null,
      },
    },
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const geradoEm = new Date().toISOString();

  const arquivosSaida = [
    escrever('classificacao-tributaria.json', {
      schema: SCHEMA_VERSION,
      tipo: 'classificacao-tributaria',
      meta: {
        fonte: 'https://dfe-portal.svrs.rs.gov.br/DFE/ClassificacaoTributaria',
        arquivoOrigem: path.basename(arquivos.referencia),
        descricao: 'Referência oficial de classificação tributária (CST × cClassTrib) — LC 214/2025',
        total: referencia.length,
        geradoEm,
      },
      itens: referencia,
    }),
    escrever('reforma.json', {
      schema: SCHEMA_VERSION,
      tipo: 'reforma',
      meta: {
        fonte: refReforma.metadata?.fonte ?? null,
        arquivoOrigem: path.basename(arquivos.reforma),
        descricao: 'Vínculos NCM/NBS × CST × cClassTrib da Reforma Tributária — LC 214/2025',
        totalNcm: ncm.length,
        totalNbs: nbs.length,
        totalCst: cst.length,
        totalCstClassTrib: cstClassTrib.length,
        geradoEm,
      },
      cst,
      cstClassTrib,
      ncm,
      nbs,
    }),
    escrever('nomenclatura.json', {
      schema: SCHEMA_VERSION,
      tipo: 'nomenclatura',
      meta: {
        fonte: 'Tabela NCM Vigente (Resolução Gecex)',
        arquivoOrigem: path.basename(arquivos.nomenclatura),
        vigencia: refNomen.Data_Ultima_Atualizacao_NCM ?? null,
        ato: refNomen.Ato ?? null,
        total: nomenclatura.length,
        geradoEm,
      },
      itens: nomenclatura,
    }),
    escrever('cnae.json', {
      schema: SCHEMA_VERSION,
      tipo: 'cnae',
      meta: {
        fonte: 'CNAE × Anexo Simples + Fator R (arquivo vivo)',
        arquivoOrigem: arquivos.cnae ? path.basename(arquivos.cnae) : null,
        descricao: 'Elegibilidade Simples por CNAE — anexos I–V do Simples Nacional, NÃO da LC 214/2025',
        total: cnae.length,
        geradoEm,
      },
      itens: cnae,
    }),
  ];

  const manifest = {
    schema: SCHEMA_VERSION,
    geradoEm,
    origem: {
      baseDir: origemEfetiva,
      arquivos: Object.fromEntries(Object.entries(arquivos).map(([k, v]) => [k, path.basename(v)])),
    },
    estatisticas,
    codigosIgnorados: ignorados,
    arquivos: arquivosSaida,
  };
  escrever('MANIFEST.json', manifest);

  await gatilhoIndiceIA(manifest, arquivosSaida);

  const totalBytes = arquivosSaida.reduce((s, a) => s + a.bytes, 0);
  console.log('\n Resultado:');
  console.table(arquivosSaida.map((a) => ({ arquivo: a.arquivo, 'KB': (a.bytes / 1024).toFixed(1) })));
  console.log(`   total: ${(totalBytes / 1024 / 1024).toFixed(2)} MB em ${Date.now() - t0} ms`);
  console.log('\n Contagens:', JSON.stringify(estatisticas));

  if (problemas.length) {
    console.log('\n ⚠ Avisos de integridade:');
    problemas.forEach((p) => console.log(`   - ${p}`));
  } else {
    console.log('\n ✔ Integridade: nenhuma inconsistência cruzada.');
  }

  if (ignorados.length) {
    console.log(`\n Códigos descartados (${ignorados.length}):`);
    ignorados.slice(0, 20).forEach((i) => console.log(`   - [${i.origem}] ${i.codigo} — ${i.motivo}`));
    if (ignorados.length > 20) console.log(`   … e mais ${ignorados.length - 20} (ver MANIFEST.json → codigosIgnorados)`);
  }

  // Amostra de fumaça: garante que a chave de lookup usada pela aplicação existe.
  const amostra = ncm.find((n) => n.codigo === '02011000') ?? ncm[0];
  const ref = referencia.find((r) => r.cClassTrib === amostra.cClassTrib);
  console.log(`\n Amostra ${amostra.codigo}: CST ${amostra.cst} · cClassTrib ${amostra.cClassTrib}`
    + ` · redução IBS ${ref?.pRedIBS ?? '—'}% · CBS ${ref?.pRedCBS ?? '—'}% · anexo ${ref?.anexo ?? '—'}`);

  // Amostra Phase 7 (Serviços): NBS vivo + CNAE.
  const amostraNbs = nbs.find((n) => n.codigo === '122011100') ?? nbs[0];
  if (amostraNbs) {
    console.log(` Amostra NBS ${amostraNbs.codigo}: CST ${amostraNbs.cst} · cClassTrib ${amostraNbs.cClassTrib}`
      + ` · ${amostraNbs.baseLegal || '—'} (${nbs.length} vínculos, ${nbsVivo.duplicados} dups removidos)`);
  }
  const amostraCnae = cnae.find((c) => c.codigo7 === '8599601') ?? cnae[0];
  if (amostraCnae) {
    console.log(` Amostra CNAE ${amostraCnae.codigoFormatado}: ${amostraCnae.descricao || '—'}`
      + ` · ${amostraCnae.situacao} · Anexo Simples ${amostraCnae.anexos.join('/') || '—'} (${cnae.length} CNAEs)`);
  } else {
    console.log(' Amostra CNAE: store vazia (arquivo vivo ausente — tolerado).');
  }

  process.exit(problemas.length ? 0 : 0);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build-base.mjs')) {
  main().catch((err) => {
    console.error('\n✖ Falha na compilação da base:', err.message);
    process.exit(1);
  });
}
