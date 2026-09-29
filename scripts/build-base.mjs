/**
 * build-base.mjs
 * ==============
 * Compila as bases oficiais da Reforma Tributária em artefatos normalizados,
 * prontos para serem embutidos no aplicativo.
 *
 * ENTRADAS (pasta do projeto pai, sobrescrevível com AURUM_BASE_DIR):
 *   - classificacao_tributaria.json       -> referência CST x cClassTrib (164 registros)
 *   - reforma_tributaria_por_ncm.json     -> vinculos NCM/NBS + tabelas CST/cClassTrib
 *   - Tabela_NCM_Vigente_*.json           -> nomenclatura NCM vigente
 *
 * SAÍDA (public/base/):
 *   - classificacao-tributaria.json  referência normalizada (chave: cClassTrib)
 *   - reforma.json                   CST + cClassTrib + vinculos NCM
 *   - nomenclatura.json              nomenclatura vigente (auto-preenchimento)
 *   - MANIFEST.json                  metadados, contagens e checksums
 *
 * Por que normalizar?
 *   O JSON de origem tem 16 MB porque repete a mesma referencia (2,5 KB) em cada
 *   um dos 2.345 NCM. Ao normalizar (3FN) o mesmo conteudo cai para ~1,5 MB e a
 *   aplicacao carrega com um unico JOIN em memoria, sem perda de informacao.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.resolve(process.env.AURUM_BASE_DIR || path.join(PROJECT_ROOT, '..'));
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
  if (!fs.existsSync(SOURCE_DIR)) return null;
  const achado = fs.readdirSync(SOURCE_DIR).find((f) => new RegExp(padrao).test(f));
  return achado ? path.join(SOURCE_DIR, achado) : null;
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
    aliquotaIBS: toNum(n.aliquotaIBS),
    aliquotaCBS: toNum(n.aliquotaCBS),
    descricao: String(n.descricaoCompleta ?? '').trim(),
  })).filter((n) => n.codigo.length === 9);
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

function validar(referencia, cst, cstClassTrib, ncm, nomenclatura, ignorados = []) {
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

async function main() {
  console.log(' Aurum Tax NCM — compilação da base tributária');
  console.log(`   origem: ${SOURCE_DIR}`);

  const arquivos = {
    referencia: localizar('^classificacao_tributaria\\.json$'),
    reforma: localizar('^reforma_tributaria_por_ncm\\.json$'),
    nomenclatura: localizar('^Tabela_NCM_Vigente_.*\\.json$'),
  };

  const ausentes = Object.entries(arquivos).filter(([, v]) => !v).map(([k]) => k);
  if (ausentes.length) {
    console.error(`\n✖ Arquivos de origem ausentes: ${ausentes.join(', ')}`);
    console.error('  Defina AURUM_BASE_DIR apontando para a pasta que contém as bases.');
    process.exit(1);
  }

  console.log(`   referencia : ${path.basename(arquivos.referencia)}`);
  console.log(`   reforma     : ${path.basename(arquivos.reforma)}`);
  console.log(`   nomenclatura: ${path.basename(arquivos.nomenclatura)}`);

  const t0 = Date.now();
  const refBruta = lerJson(arquivos.referencia);
  const refReforma = lerJson(arquivos.reforma);
  const refNomen = lerJson(arquivos.nomenclatura);

  const referencia = normalizarReferencia(refBruta);
  const cst = normalizarCst(refReforma.tabelasAuxiliares?.cst);
  const cstClassTrib = normalizarCstClassTrib(refReforma.tabelasAuxiliares?.cstClassTrib);
  const ncm = normalizarNcm(refReforma.NCM);
  const nbs = normalizarNbs(refReforma.NBS);
  const nomenclatura = normalizarNomenclatura(refNomen);

  const ignorados = coletarIgnorados(refReforma, refNomen);
  const { problemas, estatisticas } = validar(referencia, cst, cstClassTrib, ncm, nomenclatura, ignorados);

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
  ];

  const manifest = {
    schema: SCHEMA_VERSION,
    geradoEm,
    origem: {
      baseDir: SOURCE_DIR,
      arquivos: Object.fromEntries(Object.entries(arquivos).map(([k, v]) => [k, path.basename(v)])),
    },
    estatisticas,
    codigosIgnorados: ignorados,
    arquivos: arquivosSaida,
  };
  escrever('MANIFEST.json', manifest);

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

  process.exit(problemas.length ? 0 : 0);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build-base.mjs')) {
  main().catch((err) => {
    console.error('\n✖ Falha na compilação da base:', err.message);
    process.exit(1);
  });
}
