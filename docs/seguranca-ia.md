# Segurança IA — Threat Model e Proteção (06-08 / IA-08)

Phase 6 · Aurum Tax NCM · 2026-09-30 · status: **implementado offline, UAT pendente (pacote real + GGUF real)**

## 0. Tese honesta (leia primeiro)

O dono da máquina tem acesso físico aos bytes. Nenhuma ofuscação ou cifragem
local impede um atacante motivado com debugger e tempo — o objetivo aqui é
**mitigação anti-cópia trivial** (elevar o custo de extração casual), NÃO
blindagem. Este documento lista o que está protegido, os limites e como validar
cada alegação.

## 1. Superfície protegida

| # | Artefato | Ameaça | Mitigação | Onde |
|---|---|---|---|---|
| 1 | `electron/dist/ia-worker.cjs` (lógica RAG/seleção) | leitura casual do JS no asar | ofuscação: preset médio (`javascript-obfuscator`) no pack; **leve própria** offline (strip comentários + rename de 26 símbolos internos, protocolo IPC intacto) | `scripts/ofuscar-ia.cjs` |
| 2 | `ailo-152m-v2-q4_k_m.gguf` (~97 MB) em repouso | cópia direta do `.gguf` do instalador | cifragem AES-256-GCM → `assets/aux.dat` (`MAGIC‖IV‖ct‖TAG`); `strings` não revela header `GGUF` | `scripts/criptografar-modelo-ia.mjs` |
| 3 | GGUF em runtime | dump do plaintext em disco (swap/tmp) | `lerModeloSeguro()` descriptografa por **stream em memória**; o módulo não contém nenhum `writeFile` (auditável por grep) | `electron/ia/modelo-seguro.cjs` |
| 4 | Descoberta por nome | `find *.gguf` / `*.idx` no instalado | rename: `modelo.gguf→assets/aux.dat`, `indice-ncm/→assets/idx/` (resolução em `caminhos-ia.cjs`, aceita os dois layouts) | `electron/ia/caminhos-ia.cjs` |
| 5 | Chave | chave no repo/instalador | chave NUNCA commitada (`.gitignore`: `assets/aux.dat*`); build via env, runtime via `safeStorage` (OS keychain) — §4 | este doc |

Fora de escopo (por design): NBS (módulo só conhece NCM), rede (worker sem
sockets — verificado por grep em `docs/diagnostico-fase-4.md`), PII (só local).

## 2. O que está protegido vs. limites honestos

**Protegido (validável hoje, offline):**

- Worker ofuscado passa `node --check` + smoke (`buscar "frango vivo"` top-1
  cap. 01, `classificar` responde) — o script **restaura o original** se falhar.
- Pipeline de cifra validado com dummy: MAGIC ok, header GGUF ilegível no
  ciphertext, round-trip SHA256 igual em memória, chave errada rejeitada (GCM).
- `afterPack` reporta estado 06-08 sem quebrar o pack (avisos, nunca throws novos).

**Limites (não alegar o contrário):**

1. Ofuscação leve ≠ preset médio: strings legíveis permanecem até o UAT com
   `javascript-obfuscator` (o modo real aplica `stringArray`).
2. AES-GCM protege **em repouso**. Com a chave em memória no runtime, um
   atacante com debugger pode extrair o modelo — mitigação, não blindagem.
3. `node-llama-cpp` v3 carrega por **PATH em disco**: a carga 100% em memória
   a partir do Buffer exige API de buffer do loader — pendência UAT explícita
   (o worker falha de forma **controlada e audível**, nunca grava plaintext).
4. Chave via env em dev aparece em histórico de shell — usar variável de sessão
   (`$env:AURUM_IA_KEY_HEX=...` sem persistir) e rotacionar (§6).

## 3. Como validar

```powershell
# 1. Ofuscação leve + validações automáticas (sintaxe + smoke frango vivo)
node electron/esbuild.mjs
node scripts/ofuscar-ia.cjs
# esperado: modo=leve-offline, PASS ([pronto → init-mock → buscar → classificar → encerrar])

# 2. Só validar, sem modificar
node scripts/ofuscar-ia.cjs --check

# 3. Pipeline de cifra (dummy, GGUF ausente)
node scripts/criptografar-modelo-ia.mjs --check
# esperado: 3× PASS (MAGIC/strings, round-trip, chave errada)

# 4. Com o aux.dat real (UAT): sem header GGUF legível, MAGIC presente
node scripts/criptografar-modelo-ia.mjs --info --entrada assets/aux.dat
# 5. IA responde com modelo cifrado presente (mock não quebrado + init .dat controlado)
node scripts/after-pack-ia.cjs
```

Critérios de aceite 06-08: `strings assets/aux.dat` sem `GGUF`; worker
ofuscado responde `buscar`/`classificar`; helper sem escrita em disco
(`grep -n "writeFile\|createWriteStream" electron/ia/modelo-seguro.cjs` vazio);
este doc lista limites.

## 4. Chave em runtime (safeStorage) — integração no main

A chave de build (env) cifra o `aux.dat` **uma vez**. No instalado, a chave vive
no keychain do SO via `safeStorage`; o main a entrega ao worker já resolvida:

```ts
// electron/main.ts (UAT — snippet, não aplicado offline)
import { safeStorage } from 'electron'
const CHAVE_BLOB = path.join(app.getPath('userData'), 'ia-chave.bin') // gravado com safeStorage.encryptString
const chave = safeStorage.decryptString(fs.readFileSync(CHAVE_BLOB))   // hex 64 chars
// repassar ao worker no init real: { cmd:'init', modelPath: auxDat, chaveHex: chave }
// + zerar a string asssim que possível; NUNCA logar, NUNCA persistir em claro.
```

O worker usa `lerModeloSeguro({ caminho, chave })` — o parâmetro tem
precedência sobre o env. Em dev, exporte a env só na sessão:

```powershell
$env:AURUM_IA_KEY_HEX = (python -c "import secrets;print(secrets.token_hex(32))")
# nóte: gere UMA vez por release e guarde no cofre; o .dat só abre com ela.
```

## 5. UAT pendente (com rede + GGUF real) — checklist do operador

- [ ] UAT-1 ofuscação real: `npm i --no-save javascript-obfuscator` →
      `node scripts/ofuscar-ia.cjs` (modo=`obfuscator-medio`) → PASS →
      `npm run dist:win` → instalar → `buscar "frango vivo"` responde.
- [ ] UAT-2 cifra real: definir `AURUM_IA_KEY_HEX` (cofre) →
      `node scripts/criptografar-modelo-ia.mjs --cifrar` →
      `assets/aux.dat` gerado → `--info` ok → registrar
      `cifrado <sha256>  assets/aux.dat` em `recursos-ia/CHECKSUMS.txt`.
- [ ] UAT-3 carga em memória: com `node-llama-cpp` real, concluir o ramo
      `estaCifrado()` do worker (carga via buffer; se o loader exigir path,
      usar tmp do SO com ACL restrita + wipe — documentar a decisão).
- [ ] UAT-4 rename físico + instalador: mover
      `recursos-ia/modelo/*.enc→assets/aux.dat`,
      `recursos-ia/indice-ncm/*→assets/idx/` e aplicar este diff no
      `package.json#build` (3 OS, ≤300 MB):
      ```diff
         "extraResources": [
      +    { "from": "assets/aux.dat", "to": "assets/aux.dat" },
      +    { "from": "assets/idx/", "to": "assets/idx/" },
           { "from": "recursos-ia/dados-brutos", "to": "recursos-ia/dados-brutos", ... },
      ```
      (`caminhos-ia.cjs` já resolve os dois layouts — sem mudança de código.)
- [ ] UAT-5 `safeStorage`: aplicar snippet do §4, instalar limpo, confirmar que
      a IA classifica sem env e que nenhum plaintext toca o disco (ProcMon/`strings`).
- [ ] UAT-6 rotação: §6 executado uma vez em staging antes da release.

## 6. Rotação de chave

1. Gere a nova chave no cofre (`secrets.token_hex(32)`), NUNCA no repo.
2. Re-cifre: `node scripts/criptografar-modelo-ia.mjs --cifrar` (novo `aux.dat`).
3. Atualize o sha em `CHECKSUMS.txt` e o blob `ia-chave.bin` (staging primeiro).
4. Reinstale, valide §3, invalide a chave antiga no cofre. Janela: 1 release.
