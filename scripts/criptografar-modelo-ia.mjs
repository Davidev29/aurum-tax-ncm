#!/usr/bin/env node
/**
 * criptografar-modelo-ia.mjs — Cifragem do GGUF em repouso (06-08 / IA-08).
 *
 * Formato do contêiner `assets/aux.dat`:
 *   MAGIC(8="AURUMIA1") || IV(12 aleatório) || ciphertext || TAG(16)
 * Algoritmo: AES-256-GCM (`node:crypto`, sem dependências).
 *
 * Chave (32 bytes, NUNCA commitada, NUNCA logada):
 *   - build/CLI: `--chave-hex <64 hex>` ou env `AURUM_IA_KEY_HEX`
 *     (alias: `AURUM_IA_KEY`) ou `AURUM_IA_KEY_B64`;
 *   - runtime/prod: `safeStorage` do Electron (ver docs/seguranca-ia.md §4) —
 *     este script usa env SOMENTE na hora de cifrar; o worker lê a chave
 *     via `electron/ia/modelo-seguro.cjs` (env em dev, safeStorage em prod).
 *
 * Modos:
 *   --check                  pipeline completo sobre DUMMY gerado em tmp
 *                            (GGUF ausente offline): cifra → `strings`-check
 *                            (header GGUF some no ciphertext) → descriptografa
 *                            EM MEMÓRIA → compara SHA256 → limpa tmp. Exit 0.
 *   --cifrar --entrada <gguf> --saida <aux.dat> [--chave-hex ...]
 *                            cifra real (recusa se a entrada não existir).
 *   --info --entrada <aux.dat>
 *                            valida header/MAGIC sem precisar da chave.
 *   --decifrar-test --entrada <aux.dat> [--chave-hex ...]
 *                            descriptografa EM MEMÓRIA e imprime só
 *                            sha256+tamanho (NUNCA grava plaintext em disco;
 *                            não existe opção --saida de propósito).
 *
 * Sem argumentos e sem GGUF presente: roda o --check (modo offline).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
// Entrada padrão: --entrada > env > manifesto > qualquer *.gguf (agnóstico).
function descobrirGgufPadrao() {
  const argEntrada = lerArg('--entrada');
  if (argEntrada) return path.resolve(RAIZ, argEntrada);
  const env = String(process.env.AURUM_IA_MODEL || '').trim();
  if (env && fs.existsSync(env)) return env;
  try {
    const man = path.join(RAIZ, 'recursos-ia', 'modelo', 'modelo.json');
    if (fs.existsSync(man)) {
      const j = JSON.parse(fs.readFileSync(man, 'utf8'));
      if (j && typeof j.arquivo === 'string') {
        const abs = path.join(RAIZ, 'recursos-ia', 'modelo', j.arquivo.trim());
        if (fs.existsSync(abs)) return abs;
      }
    }
  } catch (_) { /* segue */ }
  const legado = path.join(RAIZ, 'recursos-ia', 'modelo', 'Qwen3.5-2B-Q4_K_M.gguf');
  if (fs.existsSync(legado)) return legado;
  const legadoAntigo = path.join(RAIZ, 'recursos-ia', 'modelo', 'Qwen3-0.6B-Q8_0.gguf');
  if (fs.existsSync(legadoAntigo)) return legadoAntigo;
  try {
    const dir = path.join(RAIZ, 'recursos-ia', 'modelo');
    if (fs.existsSync(dir)) {
      const ggufs = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gguf'));
      if (ggufs.length) return path.join(dir, ggufs.slice().sort()[0]);
    }
  } catch (_) { /* segue */ }
  return legado;
}
const GGUF_PADRAO = descobrirGgufPadrao();
const AUX_PADRAO = path.join(RAIZ, 'assets', 'aux.dat');

export const MAGIC = Buffer.from('AURUMIA1', 'ascii');
const IV_LEN = 12;
const TAG_LEN = 16;
const ALG = 'aes-256-gcm';
const CHUNK = 1024 * 1024;

function lerArg(nome) {
  const args = process.argv.slice(2);
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
}

function temFlag(nome) {
  return process.argv.slice(2).includes(nome);
}

/** Resolve a chave de 32 bytes (CLI > env hex > env b64). Nunca loga o valor. */
export function resolverChave(chaveHexCli) {
  const hex = chaveHexCli
    || process.env.AURUM_IA_KEY_HEX
    || process.env.AURUM_IA_KEY
    || null;
  if (hex) {
    const h = String(hex).trim();
    if (!/^[0-9a-fA-F]{64}$/.test(h)) {
      throw new Error('chave HEX inválida: esperados 64 caracteres hexadecimais (32 bytes).');
    }
    return Buffer.from(h, 'hex');
  }
  const b64 = process.env.AURUM_IA_KEY_B64;
  if (b64) {
    const b = Buffer.from(String(b64).trim(), 'base64');
    if (b.length !== 32) throw new Error('chave B64 inválida: esperados 32 bytes.');
    return b;
  }
  return null;
}

function sha256Arquivo(caminho) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(caminho, 'r');
  const buf = Buffer.alloc(CHUNK);
  let n;
  try {
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

/** Cifra por stream (1 MB/chunk): entrada → saída. Retorna {ivHex, shaCipher}. */
export function cifrarArquivo(entrada, saida, chave) {
  if (!fs.existsSync(entrada)) throw new Error(`entrada ausente: ${entrada}`);
  if (path.resolve(entrada) === path.resolve(saida)) {
    throw new Error('recusa: --saida igual à --entrada (nunca sobrescrever o GGUF).');
  }
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, chave, iv);
  const fdIn = fs.openSync(entrada, 'r');
  const fdOut = fs.openSync(saida, 'w');
  const buf = Buffer.alloc(CHUNK);
  let n;
  try {
    fs.writeSync(fdOut, MAGIC);
    fs.writeSync(fdOut, iv);
    while ((n = fs.readSync(fdIn, buf, 0, buf.length, null)) > 0) {
      const out = cipher.update(buf.subarray(0, n));
      if (out.length) fs.writeSync(fdOut, out);
    }
    const fim = cipher.final();
    if (fim.length) fs.writeSync(fdOut, fim);
    fs.writeSync(fdOut, cipher.getAuthTag());
  } finally {
    fs.closeSync(fdIn);
    fs.closeSync(fdOut);
  }
  return { ivHex: iv.toString('hex'), shaCipher: sha256Arquivo(saida) };
}

/** Descriptografa para MEMÓRIA (Buffer). Nunca grava plaintext em disco. */
export function descriptografarEmMemoria(caminho, chave) {
  const st = fs.statSync(caminho);
  if (st.size < MAGIC.length + IV_LEN + TAG_LEN + 1) {
    throw new Error('arquivo pequeno demais para ser um aux.dat válido.');
  }
  const fd = fs.openSync(caminho, 'r');
  try {
    const magic = Buffer.alloc(MAGIC.length);
    fs.readSync(fd, magic, 0, magic.length, 0);
    if (!magic.equals(MAGIC)) throw new Error('MAGIC inválido (não é um aux.dat AURUMIA1).');
    const iv = Buffer.alloc(IV_LEN);
    fs.readSync(fd, iv, 0, iv.length, MAGIC.length);
    const tag = Buffer.alloc(TAG_LEN);
    fs.readSync(fd, tag, 0, tag.length, st.size - TAG_LEN);
    const decipher = crypto.createDecipheriv(ALG, chave, iv);
    decipher.setAuthTag(tag);
    const partes = [];
    const buf = Buffer.alloc(CHUNK);
    let pos = MAGIC.length + IV_LEN;
    const fim = st.size - TAG_LEN;
    while (pos < fim) {
      const want = Math.min(CHUNK, fim - pos);
      const n = fs.readSync(fd, buf, 0, want, pos);
      if (n <= 0) break;
      pos += n;
      const out = decipher.update(buf.subarray(0, n));
      if (out.length) partes.push(out);
    }
    partes.push(decipher.final());
    return Buffer.concat(partes);
  } finally {
    fs.closeSync(fd);
  }
}

/** Checagem sem chave: MAGIC + tamanhos. Imita `strings aux.dat` no essencial. */
export function inspecionar(caminho) {
  const st = fs.statSync(caminho);
  const fd = fs.openSync(caminho, 'r');
  try {
    const head = Buffer.alloc(Math.min(64, st.size));
    fs.readSync(fd, head, 0, head.length, 0);
    const temMagic = head.subarray(0, MAGIC.length).equals(MAGIC);
    const temGguf = head.subarray(0, 4).toString('ascii') === 'GGUF'
      || head.includes(Buffer.from('GGUF', 'ascii'));
    return { tamanho: st.size, temMagicAurum: temMagic, vazaHeaderGguf: temGguf };
  } finally {
    fs.closeSync(fd);
  }
}

/** Modo --check: pipeline dummy em tmp (GGUF real ausente offline). */
async function modoCheck() {
  console.log('[cripto-ia] --check: GGUF real ausente — validando pipeline com DUMMY.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-ia-check-'));
  const dummy = path.join(tmp, 'dummy.gguf');
  const cifrado = path.join(tmp, 'aux-check.dat');
  try {
    // Dummy com header GGUF realista (magic + versão + 256 KB aleatórios).
    const head = Buffer.alloc(8);
    head.write('GGUF', 0, 'ascii');
    head.writeUInt32LE(3, 4);
    fs.writeFileSync(dummy, Buffer.concat([head, crypto.randomBytes(256 * 1024)]));
    const shaOrig = sha256Arquivo(dummy);

    const chave = crypto.randomBytes(32); // efêmera, só em memória
    const { shaCipher } = cifrarArquivo(dummy, cifrado, chave);
    console.log(`[cripto-ia] dummy cifrado: ${fs.statSync(cifrado).size} bytes (sha=${shaCipher.slice(0, 16)}…)`);

    const insp = inspecionar(cifrado);
    if (!insp.temMagicAurum) throw new Error('MAGIC AURUMIA1 ausente no .dat gerado.');
    if (insp.vazaHeaderGguf) throw new Error('VAZAMENTO: header GGUF legível no ciphertext.');
    console.log('[cripto-ia] PASS: MAGIC ok; `strings` não revela header GGUF.');

    const claro = descriptografarEmMemoria(cifrado, chave);
    const shaClaro = crypto.createHash('sha256').update(claro).digest('hex');
    if (shaClaro !== shaOrig) throw new Error('round-trip divergiu (SHA256 diferente).');
    console.log('[cripto-ia] PASS: round-trip em memória íntegro (SHA256 igual, nada em disco).');

    // Chave errada deve FALHAR (autenticidade GCM).
    let negou = false;
    try {
      descriptografarEmMemoria(cifrado, crypto.randomBytes(32));
    } catch (_) {
      negou = true;
    }
    if (!negou) throw new Error('GCM aceitou chave errada (inaceitável).');
    console.log('[cripto-ia] PASS: chave errada rejeitada (auth tag GCM).');

    console.log('[cripto-ia] CHECK OK — pipeline pronto para o GGUF real (UAT §5 do doc).');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 && !fs.existsSync(GGUF_PADRAO)) {
    await modoCheck();
    return;
  }
  if (temFlag('--check')) {
    await modoCheck();
    return;
  }
  if (temFlag('--info')) {
    const entrada = path.resolve(lerArg('--entrada') || AUX_PADRAO);
    if (!fs.existsSync(entrada)) {
      console.error(`[cripto-ia] arquivo ausente: ${entrada}`);
      process.exit(1);
    }
    const insp = inspecionar(entrada);
    console.log(`[cripto-ia] ${entrada}`);
    console.log(`  tamanho=${insp.tamanho} magicAurum=${insp.temMagicAurum} vazaGguf=${insp.vazaHeaderGguf}`);
    process.exit(insp.temMagicAurum && !insp.vazaHeaderGguf ? 0 : 1);
  }
  if (temFlag('--decifrar-test')) {
    const entrada = path.resolve(lerArg('--entrada') || AUX_PADRAO);
    const chave = resolverChave(lerArg('--chave-hex'));
    if (!chave) {
      console.error('[cripto-ia] sem chave: passe --chave-hex ou defina AURUM_IA_KEY_HEX (nunca commite).');
      process.exit(1);
    }
    const claro = descriptografarEmMemoria(entrada, chave);
    console.log(`[cripto-ia] plaintext EM MEMÓRIA: ${claro.length} bytes sha256=${crypto.createHash('sha256').update(claro).digest('hex')}`);
    console.log('[cripto-ia] nada foi gravado em disco (por design não há --saida).');
    return;
  }
  if (temFlag('--cifrar')) {
    const entrada = path.resolve(lerArg('--entrada') || GGUF_PADRAO);
    const saida = path.resolve(lerArg('--saida') || AUX_PADRAO);
    const chave = resolverChave(lerArg('--chave-hex'));
    if (!chave) {
      console.error('[cripto-ia] sem chave: passe --chave-hex ou defina AURUM_IA_KEY_HEX (nunca commite).');
      process.exit(1);
    }
    if (!fs.existsSync(entrada)) {
      console.error(`[cripto-ia] GGUF ausente: ${entrada} — rode com --check (dummy) ou adquira o modelo (06-04).`);
      process.exit(1);
    }
    const fd = fs.openSync(entrada, 'r');
    const mg = Buffer.alloc(4);
    fs.readSync(fd, mg, 0, 4, 0);
    fs.closeSync(fd);
    if (mg.toString('ascii') !== 'GGUF') {
      console.warn('[cripto-ia] AVISO: entrada sem magic GGUF — cifrando mesmo assim (verifique o arquivo).');
    }
    const { shaCipher } = cifrarArquivo(entrada, saida, chave);
    const insp = inspecionar(saida);
    console.log(`[cripto-ia] cifrado: ${saida} (${insp.tamanho} bytes)`);
    console.log(`[cripto-ia] sha256(cifrado)=${shaCipher}`);
    console.log('[cripto-ia] REGISTRE esse sha em recursos-ia/CHECKSUMS.txt como "cifrado <sha>  assets/aux.dat" (UAT).');
    console.log('[cripto-ia] NUNCA commite a chave nem o aux.dat (ver .gitignore).');
    if (insp.vazaHeaderGguf) {
      console.error('[cripto-ia] FALHA: header GGUF legível na saída.');
      process.exit(1);
    }
    return;
  }
  console.error('[cripto-ia] uso: --check | --cifrar --entrada <gguf> --saida <aux.dat> | --info --entrada <dat> | --decifrar-test --entrada <dat>');
  process.exit(1);
}

await main();
