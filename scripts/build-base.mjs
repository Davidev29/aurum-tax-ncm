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
 *   - CNAE X NBS.qualclasstrib.json       -> (Phase 9) ponte CNAE → NBS (fonte não-oficial)
 *
 * SAÍDA (public/base/):
 *   - classificacao-tributaria.json  referência normalizada (chave: cClassTrib)
 *   - reforma.json                   CST + cClassTrib + vinculos NCM/NBS
 *   - nomenclatura.json              nomenclatura vigente (auto-preenchimento)
 *   - cnae.json                      CNAE × Anexo Simples (Phase 7)
 *   - cnae-nbs.json                  links CNAE → NBS + relações LC × NBS (Phase 9)
 *   - classificacoes-consolidadas.json  templates por CNAE com descrições conferidas (Phase 9)
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
    documentos: String(n.documentosFiscaisRelacionados ?? n.documentos ?? '').trim(),
    descricao: String(n.descricaoCompleta ?? n.descricao ?? '').trim(),
  })).filter((n) => n.codigo.length === 8);
}

/** `AAAA.BB.CC` somente para 8 dígitos (paridade com a aplicação). */
const fmtNcm = (d) => (d.length === 8 ? `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}` : d);

export function normalizarNbs(bruto) {
  return (bruto ?? []).map((n, i) => ({
    id: `${digits(n.codigo)}|${padCct(n.cClassTrib) ?? ''}|${i}`,
    codigo: digits(n.codigo),
    cst: padCst(n.cst) ?? '',
    cClassTrib: padCct(n.cClassTrib) ?? '',
    baseLegal: String(n.baseLegal ?? '').trim(),
    reducao: toNum(n.reducao),
    aliquotaIBS: toNum(n.aliquotaIBS),
    aliquotaCBS: toNum(n.aliquotaCBS),
    descricao: String(n.descricaoCompleta ?? n.descricao ?? '').trim(),
    documentos: String(n.documentosFiscaisRelacionados ?? n.documentos ?? '').trim(),
  })).filter((n) => n.codigo.length === 9);
}

/**
 * Une listas de vínculos NBS com dedupe por `codigo|cst|cClassTrib`
 * (a fonte publica os mesmos vínculos no arquivo vivo e no legado).
 *
 * A ordem é preservada (base primeiro, complemento depois) e os `id`
 * são reindexados de forma determinística (`codigo|cClassTrib|índice`).
 * Devolve quantos itens do complemento eram repetidos e quantos códigos
 * novos o complemento trouxe (`novos` — no fluxo oficial, os 10 NBS do
 * Anexo IX resgatados do overflow de 9 dígitos da lista `NCM`).
 */
export function unirNbs(base, complemento = []) {
  const chaveDe = (v) => `${v.codigo}|${v.cst}|${v.cClassTrib}`;
  const baseUnicos = new Set((base ?? []).filter((v) => v && typeof v === 'object').map(chaveDe)).size;
  const vistos = new Set();
  const unicos = [];
  let repetidos = 0;
  for (const v of [...(base ?? []), ...(complemento ?? [])]) {
    if (!v || typeof v !== 'object') continue;
    const chave = chaveDe(v);
    if (vistos.has(chave)) {
      repetidos++;
      continue;
    }
    vistos.add(chave);
    unicos.push(v);
  }
  unicos.forEach((v, k) => {
    v.id = `${v.codigo}|${v.cClassTrib}|${k}`;
  });
  return { unicos, repetidos, novos: Math.max(0, unicos.length - baseUnicos) };
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
// Phase 9 — ponte CNAE → NBS (`CNAE X NBS.qualclasstrib.json`, fonte NÃO-oficial)
// Os links são CANDIDATOS; alíquota/benefício só do resolvedor oficial.
// ---------------------------------------------------------------------------

/**
 * Repara mojibake latin1 sem corromper texto correto (paridade com
 * `fixLatin1` de `src/infrastructure/base/normalizacao.ts`).
 */
export const fixLatin1 = (v) => {
  if (typeof v !== 'string') return String(v ?? '');
  if (!/[ÃÂ]/.test(v)) return v;
  const bytes = [];
  for (const ch of v) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xff) return v;
    bytes.push(cp);
  }
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let len = 0;
    if (b >= 0xc2 && b <= 0xdf) len = 2;
    else if (b >= 0xe0 && b <= 0xef) len = 3;
    else if (b >= 0xf0 && b <= 0xf4) len = 4;
    if (len > 0 && i + len <= bytes.length && bytes.slice(i + 1, i + len).every((x) => x >= 0x80 && x <= 0xbf)) {
      let cp = 0;
      if (len === 2) cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      else if (len === 3) cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      else cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      const minimo = len === 2 ? 0x80 : len === 3 ? 0x800 : 0x10000;
      if (cp >= minimo && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) {
        out += String.fromCodePoint(cp);
        i += len;
        continue;
      }
    }
    out += String.fromCharCode(b);
    i += 1;
  }
  return out;
};

/** `XXXX-X/XX` (ou 7 dígitos) → `XXXXXXX`. Fora do padrão → `''`. */
export const somenteDigitosCnae7 = (v) => {
  const d = digits(v);
  return d.length === 7 ? d : '';
};

/** NBS `X.XXXX.XX.XX` → 9 dígitos. Fora do padrão → `''`. */
export const somenteDigitosNbsPonte = (v) => {
  const d = digits(v);
  return d.length === 9 ? d : '';
};

/** Um par CNAE → NBS normalizado, ou `null` quando inválido. */
export function normalizarCnaeNbsLink(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cnae7 = somenteDigitosCnae7(raw.cnae7 ?? raw.cnae ?? raw.codigoFormatado ?? raw.codigo);
  const nbs = somenteDigitosNbsPonte(raw.nbs ?? raw.codigo);
  if (!cnae7 || !nbs) return null;
  return { cnae7, cnae: fmtCnae(cnae7), nbs, fonte: raw.fonte === 'triangulacao' ? 'triangulacao' : 'por_codigo' };
}

/** Uma relação LC → NBS normalizada, ou `null` quando não é objeto. Fidelidade total à origem (1.739 linhas). */
export function normalizarLcNbsRelation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    lc: String(raw.lc ?? '').trim(),
    nbs: somenteDigitosNbsPonte(raw.nbs ?? raw.codigo),
    cct: padCct(raw.cct ?? raw.cClassTrib) ?? '',
    descricaoLc: fixLatin1(String(raw.lcd ?? raw.descricaoLc ?? '').trim()),
    descricaoNbs: fixLatin1(String(raw.nbsd ?? raw.descricaoNbs ?? '').trim()),
    descricaoCct: fixLatin1(String(raw.cctd ?? raw.descricaoCct ?? '').trim()),
    onerosa: String(raw.onerosa ?? '').trim(),
    exterior: String(raw.exterior ?? '').trim(),
    indop: String(raw.indop ?? '').trim(),
    local: fixLatin1(String(raw.local ?? '').trim()),
  };
}

/**
 * Phase 9 — parse da fonte ponte (`por_codigo` + `fallback-cnae-links` [677]
 * + `fallback-relations` [1739]). `respostas_de_rede` com url contendo
 * `google` é tracking e é DESCARTADA. Valida NBS 9 dígitos + CNAE
 * `XXXX-X/XX`, dedupe por `cnae7|nbs`. Também aceita o artefato
 * `cnae-nbs.json` já normalizado (idempotente).
 */
export function normalizarCnaeNbs(bruto) {
  const vazio = { links: [], lcNbs: [], cnaeLc: [], descricoesAuxiliares: {}, paresTriangulados: [], descartadosRede: 0, duplicados: 0, invalidos: 0 };
  if (!bruto || typeof bruto !== 'object') return vazio;

  if (Array.isArray(bruto.links)) {
    const vistos = new Set();
    for (const raw of bruto.links) {
      const link = normalizarCnaeNbsLink(raw);
      if (!link) {
        vazio.invalidos++;
        continue;
      }
      const chave = `${link.cnae7}|${link.nbs}`;
      if (vistos.has(chave)) {
        vazio.duplicados++;
        continue;
      }
      vistos.add(chave);
      vazio.links.push({ ...link });
    }
    for (const raw of (Array.isArray(bruto.lcNbs) ? bruto.lcNbs : [])) {
      const rel = normalizarLcNbsRelation(raw);
      if (rel) vazio.lcNbs.push(rel);
    }
    return vazio;
  }

  const porCodigo = bruto.por_codigo ?? {};
  const respostas = bruto.respostas_de_rede ?? [];

  const vistos = new Set();
  for (const [codigoCnae, entrada] of Object.entries(porCodigo)) {
    const listaNbs = entrada?.vinculos?.NBS;
    if (!Array.isArray(listaNbs)) continue;
    for (const nbsBruto of listaNbs) {
      const link = normalizarCnaeNbsLink({ cnae: codigoCnae, nbs: nbsBruto, fonte: 'por_codigo' });
      if (!link) {
        vazio.invalidos++;
        continue;
      }
      const chave = `${link.cnae7}|${link.nbs}`;
      if (vistos.has(chave)) {
        vazio.duplicados++;
        continue;
      }
      vistos.add(chave);
      vazio.links.push(link);
    }
  }

  const porLc = new Map();
  for (const resp of respostas) {
    const url = String(resp?.url ?? '');
    const dados = resp?.dados;
    if (/google/i.test(url)) {
      vazio.descartadosRede++;
      continue;
    }
    if (!Array.isArray(dados)) continue;
    if (/fallback-cnae-links/i.test(url)) {
      for (const r of dados) {
        if (!r || typeof r !== 'object') continue;
        const cnae7 = somenteDigitosCnae7(r.cnae);
        const lc = String(r.lc ?? '').trim();
        if (!cnae7 || !lc) {
          vazio.invalidos++;
          continue;
        }
        vazio.cnaeLc.push({ cnae7, cnae: fmtCnae(cnae7), lc });
        const cnaed = fixLatin1(String(r.cnaed ?? '').trim());
        if (cnaed && !vazio.descricoesAuxiliares[cnae7]) vazio.descricoesAuxiliares[cnae7] = cnaed;
      }
    } else if (/fallback-relations/i.test(url)) {
      // Fidelidade à origem: guarda as 1.739 linhas (3 exatas repetidas
      // inclusas — contadas em `duplicados`, sem descarte). Linhas sem NBS/cct
      // ficam com `''` e nunca participam de join (só auditoria/descrição).
      const vistosLc = new Set();
      for (const r of dados) {
        const rel = normalizarLcNbsRelation(r);
        if (!rel) {
          vazio.invalidos++;
          continue;
        }
        const chave = JSON.stringify(rel);
        if (vistosLc.has(chave)) vazio.duplicados++;
        else vistosLc.add(chave);
        vazio.lcNbs.push(rel);
        if (rel.nbs) {
          const lista = porLc.get(rel.lc) ?? [];
          lista.push(rel.nbs);
          porLc.set(rel.lc, lista);
        }
      }
    }
  }

  const triangulados = new Set();
  for (const { cnae7, lc } of vazio.cnaeLc) {
    for (const nbs of porLc.get(lc) ?? []) triangulados.add(`${cnae7}|${nbs}`);
  }
  vazio.paresTriangulados = [...triangulados];
  return vazio;
}

/** Minúsculas, sem acento, espaços colapsados — para conferência entre fontes. */
export const normalizarTextoConferencia = (v) => String(v ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

/**
 * Conferência por código entre fontes → templates consolidados.
 * Códigos batem → consolida (precedência oficial > qualclasstrib > auxiliar).
 * Divergência de código → marca `divergencia`, NÃO consolida regra oficial.
 * `beneficiosReforma` nasce vazio (runtime 09-02 resolve com ano de referência).
 */
export function construirClassificacoesConsolidadas({ cnaeOficial, porCodigo, descricoesAuxiliares, mapaDescNbs }) {
  const templates = [];
  let textosDivergentes = 0;
  let codigosDivergentes = 0;
  const nbsSemDescricaoSet = new Set();
  const cnaesComNbsSet = new Set();

  const montarVinculadas = (listaNbs) => {
    const vistas = new Set();
    const out = [];
    for (const nbs of (listaNbs ?? [])) {
      if (!nbs || vistas.has(nbs)) continue;
      vistas.add(nbs);
      const hit = mapaDescNbs.get(nbs) ?? null;
      if (!hit) nbsSemDescricaoSet.add(nbs);
      out.push({ nbs, descricao: hit?.descricao ?? null, fonteDescricao: hit?.fonte ?? null, semDescricao: !hit });
    }
    return out;
  };

  const textoVedacao = (situacao, anexos) => {
    if (situacao === 'Permitido com ressalvas') {
      return [`Permitido com ressalvas no Simples Nacional${anexos.length ? ` (Anexo Simples ${anexos.join('/')})` : ''} — verificar ressalvas da atividade.`];
    }
    if (situacao === 'Depende da atividade') {
      return ['Enquadramento depende da atividade exercida — confirmar CNAE e objeto social antes de optar.'];
    }
    return [`Atividade permitida no Simples Nacional${anexos.length ? ` (Anexo Simples ${anexos.join('/')})` : ''}.`];
  };

  for (const reg of cnaeOficial) {
    const chaveFmt = reg.codigoFormatado;
    const entrada = porCodigo[chaveFmt] ?? porCodigo[reg.codigo7];
    const descPonte = fixLatin1(String(entrada?.descricao ?? '').trim());
    const descAux = fixLatin1(String(descricoesAuxiliares[reg.codigo7] ?? '').trim());
    const oficial = String(reg.descricao ?? '').trim();
    const descricao = oficial || descPonte || descAux;
    const fonteDescricao = oficial ? 'oficial' : (descPonte ? 'qualclasstrib' : 'auxiliar');
    let divergencia = null;
    if (entrada) {
      cnaesComNbsSet.add(reg.codigo7);
      if (oficial && descPonte && normalizarTextoConferencia(oficial) !== normalizarTextoConferencia(descPonte)) {
        textosDivergentes++;
        divergencia = { tipo: 'descricao-divergente', detalhe: `oficial prevalece sobre ponte: "${descPonte.slice(0, 80)}"` };
      }
    }
    templates.push({
      cnae7: reg.codigo7,
      codigoFormatado: reg.codigoFormatado,
      descricao,
      fonteDescricao,
      anexoSimples: reg.anexos,
      situacao: reg.situacao,
      fatorR: reg.fatorR,
      vedacoes: textoVedacao(reg.situacao, reg.anexos),
      nbsVinculadas: montarVinculadas((entrada?.vinculos?.NBS ?? []).map((n) => somenteDigitosNbsPonte(n)).filter(Boolean)),
      beneficiosReforma: [],
      divergencia,
      estadoNbs: entrada ? 'mapeado' : 'sem-mapeamento',
    });
  }

  // 55 códigos legados só na ponte: links preservados, SEM regra oficial.
  const oficiais = new Set(cnaeOficial.flatMap((r) => [r.codigoFormatado, r.codigo7]));
  for (const [codigoCnae, entrada] of Object.entries(porCodigo)) {
    if (oficiais.has(codigoCnae) || oficiais.has(somenteDigitosCnae7(codigoCnae))) continue;
    const cnae7 = somenteDigitosCnae7(codigoCnae);
    if (!cnae7) continue;
    codigosDivergentes++;
    cnaesComNbsSet.add(cnae7);
    templates.push({
      cnae7,
      codigoFormatado: fmtCnae(cnae7),
      descricao: fixLatin1(String(entrada?.descricao ?? '').trim()),
      fonteDescricao: 'qualclasstrib',
      anexoSimples: [],
      situacao: 'Depende da atividade',
      fatorR: false,
      vedacoes: ['Código ausente da base oficial de CNAEs — sem regra do Simples; links NBS preservados como candidatos da ponte.'],
      nbsVinculadas: montarVinculadas((entrada?.vinculos?.NBS ?? []).map((n) => somenteDigitosNbsPonte(n)).filter(Boolean)),
      beneficiosReforma: [],
      divergencia: { tipo: 'codigo-ausente-oficial', detalhe: 'código da ponte sem correspondência nos 1.090 oficiais (legado)' },
      estadoNbs: 'divergencia',
    });
  }

  return {
    templates,
    conferencia: {
      cnaesComRegras: cnaeOficial.length,
      cnaesComNbs: cnaesComNbsSet.size,
      textosDivergentes,
      codigosDivergentes,
      descricoesConferidas: cnaesComNbsSet.size - codigosDivergentes - textosDivergentes,
      descricoesDivergentes: codigosDivergentes + textosDivergentes,
      nbsSemDescricao: nbsSemDescricaoSet.size,
    },
  };
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

  // A lista `NCM` da fonte contém 10 NBS do Anexo IX (9 dígitos, art. 138)
  // que são RESGATADOS para os vínculos NBS — não são descarte. Só códigos
  // com outro tamanho são ignorados de verdade. Simétrico na lista `NBS`
  // (8 dígitos ali seriam NCM resgatado).
  const varrer = (lista, esperado, origem, resgatado) => {
    (lista ?? []).forEach((item, idx) => {
      const bruto = String(item?.codigo ?? item?.Codigo ?? '').trim();
      const dig = digits(bruto);
      if (!dig) {
        ignorados.push({ origem, indice: idx, codigo: bruto || '(vazio)', motivo: 'código vazio' });
      } else if (dig.length !== esperado && dig.length !== resgatado) {
        ignorados.push({
          origem,
          indice: idx,
          codigo: bruto,
          motivo: `${dig.length} dígitos (esperado ${esperado})`,
        });
      }
    });
  };

  varrer(refReforma.NCM, 8, 'NCM', 9);
  varrer(refReforma.NBS, 9, 'NBS', 8);

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

  // NBS: todo vínculo precisa existir na referência e no par CST×cClassTrib —
  // sem isso a conferência do serviço cai em regra geral (sem descrição,
  // redução, anexo ou LC). É o que faltava aos 10 NBS do Anexo IX.
  const nbs = extras.nbs ?? [];
  const nbsSemRef = nbs.filter((n) => !cctRef.has(n.cClassTrib));
  const nbsSemPar = nbs.filter((n) => !cctTabela.has(`${n.cst}|${n.cClassTrib}`));
  const nbsDuplicados = nbs.length - new Set(nbs.map((n) => `${n.codigo}|${n.cst}|${n.cClassTrib}`)).size;
  if (nbsSemRef.length) problemas.push(`${nbsSemRef.length} NBS sem correspondência na referência cClassTrib (ex.: ${nbsSemRef[0].cClassTrib})`);
  if (nbsSemPar.length) problemas.push(`${nbsSemPar.length} NBS sem par CST×cClassTrib na tabela auxiliar (ex.: ${nbsSemPar[0].cst}|${nbsSemPar[0].cClassTrib})`);
  if (nbsDuplicados) problemas.push(`${nbsDuplicados} vínculos NBS duplicados`);

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
      nbs: nbs.length,
      nbsSemReferencia: nbsSemRef.length,
      nbsDuplicados,
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
    // Phase 9 — ponte CNAE → NBS (fonte não-oficial; links são candidatos).
    ponteCnaeNbs: localizar('^CNAE X NBS\\.qualclasstrib\\.json$'),
  };

  const ausentes = Object.entries({ referencia: arquivos.referencia, reforma: arquivos.reforma, nomenclatura: arquivos.nomenclatura, ponteCnaeNbs: arquivos.ponteCnaeNbs }).filter(([, v]) => !v).map(([k]) => k);
  // Phase 7 — arquivos vivos são OPCIONAIS: sem eles, NBS cai no legado e
  // CNAE nasce vazio (a base embutida segue válida para NCM).
  const vivosAusentes = ['cnae', 'nbsServicos'].filter((k) => !arquivos[k]);
  if (ausentes.length) {
    // Tolera fontes ausentes quando a saída versionada já existe: `public/base/`
    // é commitado no repo, então `npm run build`/`dist` funciona em qualquer
    // máquina com só `git clone + npm ci` (sem os JSONs brutos).
    const saidasVersionadas = ['classificacao-tributaria.json', 'reforma.json', 'nomenclatura.json', 'cnae.json', 'cnae-nbs.json', 'classificacoes-consolidadas.json', 'MANIFEST.json'];
    const saidasOk = saidasVersionadas.every((f) => fs.existsSync(path.join(OUT_DIR, f)));
    if (saidasOk) {
      console.warn(`\n⚠ Fontes ausentes (${ausentes.join(', ')}) — usando public/base/ versionado.`);
      console.warn('  Para atualizar: jogue os JSONs em bases-fonte/ e rode `npm run base`.');
      return;
    }
    console.error(`\n✖ Arquivos de origem ausentes: ${ausentes.join(', ')}`);
    console.error('  Jogue os JSONs em Aurum Tax NCM/bases-fonte/ e rode `npm run base`.');
    process.exit(1);
  }

  const origemEfetiva = path.dirname(arquivos.referencia);
  console.log(`   origem efetiva: ${origemEfetiva}`);
  console.log(`   referencia : ${path.basename(arquivos.referencia)}`);
  console.log(`   reforma     : ${path.basename(arquivos.reforma)}`);
  console.log(`   nomenclatura: ${path.basename(arquivos.nomenclatura)}`);
  console.log(`   cnae        : ${arquivos.cnae ? path.basename(arquivos.cnae) : '(ausente — store CNAE vazia)'}`);
  console.log(`   nbsServicos : ${arquivos.nbsServicos ? path.basename(arquivos.nbsServicos) : '(ausente — NBS do legado)'}`);
  console.log(`   ponteCnaeNbs: ${arquivos.ponteCnaeNbs ? path.basename(arquivos.ponteCnaeNbs) : '(ausente — sem ponte CNAE→NBS)'}`);
  if (vivosAusentes.length) console.log(`   vivos ausentes: ${vivosAusentes.join(', ')} (tolerado)`);

  const t0 = Date.now();
  const refBruta = lerJson(arquivos.referencia);
  const refReforma = lerJson(arquivos.reforma);
  const refNomen = lerJson(arquivos.nomenclatura);
  const refCnae = arquivos.cnae ? lerJson(arquivos.cnae) : [];
  const refNbsVivo = arquivos.nbsServicos ? lerJson(arquivos.nbsServicos) : null;
  const refPonte = lerJson(arquivos.ponteCnaeNbs);

  const referencia = normalizarReferencia(refBruta);
  const cst = normalizarCst(refReforma.tabelasAuxiliares?.cst);
  const cstClassTrib = normalizarCstClassTrib(refReforma.tabelasAuxiliares?.cstClassTrib);
  const ncm = normalizarNcm(refReforma.NCM);
  // Phase 7 — NBS prefere o arquivo vivo (dedupe); o legado (`reforma.NBS`) e
  // o overflow de 9 dígitos publicado DENTRO da lista `NCM` completam o que
  // faltar. Esse overflow são 10 NBS do Anexo IX (art. 138, 200/200038 —
  // ex.: 114052200) que antes caíam em `codigosIgnorados` e cuja conferência
  // voltava em regra geral (sem descrição, redução, anexo ou LC).
  const nbsLegado = normalizarNbs(refReforma.NBS);
  const nbsOverflowNcm = normalizarNbs(refReforma.NCM);
  const nbsVivo = refNbsVivo ? normalizarNbsServicos(refNbsVivo) : { vinculos: [], duplicados: 0 };
  const baseNbs = refNbsVivo ? nbsVivo.vinculos : nbsLegado;
  const complementoNbs = refNbsVivo ? [...nbsLegado, ...nbsOverflowNcm] : [...nbsOverflowNcm];
  const { unicos: nbs, repetidos: nbsRepetidosMerge } = unirNbs(baseNbs, complementoNbs);
  // `nbsDuplicados` = linhas repetidas na origem efetiva (vivo: 137 linhas →
  // 112; o legado tem o mesmo conteúdo e entra só como rede de segurança,
  // sem inflar a métrica — o overflow resgatado não tem repetidos).
  const nbsDuplicados = refNbsVivo ? nbsVivo.duplicados : nbsRepetidosMerge;
  const cnae = normalizarCnaeAnexo(refCnae);
  const nomenclatura = normalizarNomenclatura(refNomen);

  // Phase 9 — ponte CNAE → NBS: `por_codigo` (links) + `fallback-cnae-links`
  // (677, descrições auxiliares + triangulação) + `fallback-relations`
  // (1739, store lcNbs + descrições NBS). Tracking Google descartado.
  const cnaeNbsNorm = normalizarCnaeNbs(refPonte);
  const linksTriangulados = new Set(cnaeNbsNorm.paresTriangulados);
  const linksDiretos = new Set(cnaeNbsNorm.links.map((l) => `${l.cnae7}|${l.nbs}`));
  const triangulacaoAcordo = [...linksTriangulados].filter((k) => linksDiretos.has(k)).length;
  // Descrições NBS por precedência: vivo > reforma (legado) > ponte (nbsd).
  const mapaDescNbs = new Map();
  for (const v of nbsVivo.vinculos) {
    if (v.descricao && !mapaDescNbs.has(v.codigo)) mapaDescNbs.set(v.codigo, { descricao: v.descricao, fonte: 'oficial' });
  }
  for (const v of nbsLegado) {
    if (v.descricao && !mapaDescNbs.has(v.codigo)) mapaDescNbs.set(v.codigo, { descricao: v.descricao, fonte: 'oficial' });
  }
  for (const rel of cnaeNbsNorm.lcNbs) {
    if (rel.descricaoNbs && !mapaDescNbs.has(rel.nbs)) mapaDescNbs.set(rel.nbs, { descricao: rel.descricaoNbs, fonte: 'qualclasstrib' });
  }
  const { templates, conferencia } = construirClassificacoesConsolidadas({
    cnaeOficial: cnae,
    porCodigo: refPonte?.por_codigo ?? {},
    descricoesAuxiliares: cnaeNbsNorm.descricoesAuxiliares,
    mapaDescNbs,
  });
  const nbsUnicasPonte = new Set(cnaeNbsNorm.links.map((l) => l.nbs)).size;

  const ignorados = coletarIgnorados(refReforma, refNomen);
  const { problemas, estatisticas } = validar(referencia, cst, cstClassTrib, ncm, nomenclatura, ignorados, {
    nbs,
    estatisticas: {
      cnae: cnae.length,
      nbsServicos: nbs.length,
      nbsDuplicados,
      nbsResgatadosOverflow: nbsOverflowNcm.filter((v) =>
        nbs.some((u) => u.codigo === v.codigo && u.cst === v.cst && u.cClassTrib === v.cClassTrib),
      ).length,
      fontesVivas: {
        cnae: arquivos.cnae ? path.basename(arquivos.cnae) : null,
        nbsServicos: arquivos.nbsServicos ? path.basename(arquivos.nbsServicos) : null,
        ponteCnaeNbs: path.basename(arquivos.ponteCnaeNbs),
      },
      // Phase 9 — ponte CNAE → NBS + conferência entre fontes.
      cnaesComRegras: conferencia.cnaesComRegras,
      cnaesComNbs: conferencia.cnaesComNbs,
      cnaeNbsLinks: cnaeNbsNorm.links.length,
      nbsUnicas: nbsUnicasPonte,
      lcLinks: cnaeNbsNorm.cnaeLc.length,
      lcNbs: cnaeNbsNorm.lcNbs.length,
      descricoesConferidas: conferencia.descricoesConferidas,
      descricoesDivergentes: conferencia.descricoesDivergentes,
      nbsSemDescricao: conferencia.nbsSemDescricao,
      triangulacaoAcordo,
      respostasRedeDescartadas: cnaeNbsNorm.descartadosRede,
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
    escrever('cnae-nbs.json', {
      schema: SCHEMA_VERSION,
      tipo: 'cnae-nbs',
      meta: {
        fonte: 'Ponte CNAE → NBS (fonte NÃO-oficial qualclasstrib.com.br — links são candidatos; verdade fiscal só do resolvedor oficial)',
        arquivoOrigem: path.basename(arquivos.ponteCnaeNbs),
        descricao: 'Links CNAE→NBS (por_codigo, dedupe cnae7|nbs) + relações LC×NBS (fallback-relations). Tracking Google descartado.',
        totalLinks: cnaeNbsNorm.links.length,
        totalCnaes: conferencia.cnaesComNbs,
        totalNbsUnicas: nbsUnicasPonte,
        triangulacao: { pares: cnaeNbsNorm.paresTriangulados.length, acordo: triangulacaoAcordo },
        respostasRedeDescartadas: cnaeNbsNorm.descartadosRede,
        geradoEm,
      },
      links: cnaeNbsNorm.links,
      lcNbs: cnaeNbsNorm.lcNbs,
    }),
    escrever('classificacoes-consolidadas.json', {
      schema: SCHEMA_VERSION,
      tipo: 'classificacoes-consolidadas',
      meta: {
        fonte: 'Conferência CNAE entre base oficial viva × ponte qualclasstrib × auxiliar (precedência oficial > qualclasstrib > auxiliar)',
        descricao: 'Template reutilizável por CNAE (regra sempre; NBS condicional; beneficiosReforma vazio — runtime 09-02 resolve com ano de referência)',
        total: templates.length,
        conferencia: {
          codigosDivergentes: conferencia.codigosDivergentes,
          textosDivergentes: conferencia.textosDivergentes,
          descricoesConferidas: conferencia.descricoesConferidas,
          descricoesDivergentes: conferencia.descricoesDivergentes,
          nbsSemDescricao: conferencia.nbsSemDescricao,
        },
        geradoEm,
      },
      itens: templates,
    }),
  ];

  const manifest = {
    schema: SCHEMA_VERSION,
    geradoEm,
    origem: {
      baseDir: origemEfetiva,
      arquivos: Object.fromEntries(Object.entries(arquivos).map(([k, v]) => [k, path.basename(v)])),
    },
    // Phase 9 (G) — proveniência auditável da fonte ponte.
    fontesVivas: {
      qualclasstrib: {
        origem: 'qualclasstrib.com.br (fonte ponte NÃO-oficial — links CNAE→NBS são candidatos)',
        licenca: 'sem licença declarada; uso como ponte de candidatos — verdade fiscal só do resolvedor oficial (LC 214/2025)',
        capturaEm: fs.statSync(arquivos.ponteCnaeNbs).mtime.toISOString(),
        cadencia: 'sob demanda (re-capturar a cada atualização da base)',
        notaRede: 'respostas_de_rede com url contendo `google` (tracking adtrafficquality) descartada no import',
      },
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
      + ` · ${amostraNbs.baseLegal || '—'} (${nbs.length} vínculos, ${nbsDuplicados} dups removidos)`);
  }
  const amostraNbsIx = nbs.find((n) => n.codigo === '114052200');
  if (amostraNbsIx) {
    const refIx = referencia.find((r) => r.id === `${amostraNbsIx.cst}|${amostraNbsIx.cClassTrib}`);
    console.log(` Amostra NBS Anexo IX ${amostraNbsIx.codigo}: CST ${amostraNbsIx.cst} · cClassTrib ${amostraNbsIx.cClassTrib}`
      + ` · redução IBS ${refIx?.pRedIBS ?? '—'}% · CBS ${refIx?.pRedCBS ?? '—'}% · anexo ${refIx?.anexo ?? '—'} (resgatado do overflow NCM)`);
  } else {
    console.log(' Amostra NBS Anexo IX 114052200: AUSENTE — overflow NCM não resgatado (verificar fonte).');
  }
  const amostraCnae = cnae.find((c) => c.codigo7 === '8599601') ?? cnae[0];
  if (amostraCnae) {
    console.log(` Amostra CNAE ${amostraCnae.codigoFormatado}: ${amostraCnae.descricao || '—'}`
      + ` · ${amostraCnae.situacao} · Anexo Simples ${amostraCnae.anexos.join('/') || '—'} (${cnae.length} CNAEs)`);
  } else {
    console.log(' Amostra CNAE: store vazia (arquivo vivo ausente — tolerado).');
  }

  // Amostra Phase 9 (ponte CNAE → NBS + template consolidado).
  const links0161 = cnaeNbsNorm.links.filter((l) => l.cnae === '0161-0/01');
  const tpl0161 = templates.find((t) => t.codigoFormatado === '0161-0/01');
  console.log(` Amostra ponte 0161-0/01: ${links0161.length} link(s)${links0161.length ? ` → ${links0161.map((l) => l.nbs).join(',')}` : ''}`
    + ` · template ${tpl0161 ? `ok (${tpl0161.situacao}, ${tpl0161.nbsVinculadas.length} NBS)` : 'AUSENTE'}`);
  console.log(` Ponte CNAE→NBS: ${cnaeNbsNorm.links.length} links · ${conferencia.cnaesComNbs} CNAEs com NBS`
    + ` · ${nbsUnicasPonte} NBS únicas · lcLinks ${cnaeNbsNorm.cnaeLc.length} · lcNbs ${cnaeNbsNorm.lcNbs.length}`
    + ` · conferidas ${conferencia.descricoesConferidas} · divergentes ${conferencia.descricoesDivergentes}`
    + ` (código ${conferencia.codigosDivergentes} + texto ${conferencia.textosDivergentes})`
    + ` · triangulação ${triangulacaoAcordo}/${cnaeNbsNorm.paresTriangulados.length} em acordo`
    + ` · tracking descartado ${cnaeNbsNorm.descartadosRede} · inválidos ${cnaeNbsNorm.invalidos} · dups ${cnaeNbsNorm.duplicados}`);

  process.exit(problemas.length ? 0 : 0);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build-base.mjs')) {
  main().catch((err) => {
    console.error('\n✖ Falha na compilação da base:', err.message);
    process.exit(1);
  });
}
