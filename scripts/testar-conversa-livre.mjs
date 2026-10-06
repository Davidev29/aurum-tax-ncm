import { fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const WORKER = path.join(REPO, 'electron', 'ia', 'ia-worker.cjs');
const DIR_MODELO = path.join(REPO, 'recursos-ia', 'modelo');
// Modelo agnóstico: --modelo <path> > env AURUM_IA_MODEL > manifesto >
// legado > qualquer *.gguf (maior vence). Trocar o .gguf = trocar o modelo.
function descobrirModelo() {
  const arg = process.argv.slice(2);
  const i = arg.indexOf('--modelo');
  if (i >= 0 && arg[i + 1]) return path.resolve(arg[i + 1]);
  const env = String(process.env.AURUM_IA_MODEL || '').trim();
  if (env && fs.existsSync(env)) return env;
  try {
    const man = path.join(DIR_MODELO, 'modelo.json');
    if (fs.existsSync(man)) {
      const j = JSON.parse(fs.readFileSync(man, 'utf8'));
      if (j && typeof j.arquivo === 'string') {
        const abs = path.join(DIR_MODELO, j.arquivo.trim());
        if (fs.existsSync(abs)) return abs;
      }
    }
  } catch (_) { /* segue */ }
  const legado = path.join(DIR_MODELO, 'Qwen3.5-2B-Q4_K_M.gguf');
  if (fs.existsSync(legado)) return legado;
  const legadoAntigo = path.join(DIR_MODELO, 'Qwen3-0.6B-Q8_0.gguf');
  if (fs.existsSync(legadoAntigo)) return legadoAntigo;
  try {
    if (fs.existsSync(DIR_MODELO)) {
      const ggufs = fs.readdirSync(DIR_MODELO)
        .filter((f) => f.toLowerCase().endsWith('.gguf'))
        .map((f) => ({ abs: path.join(DIR_MODELO, f), bytes: fs.statSync(path.join(DIR_MODELO, f)).size }))
        .filter((e) => e.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes);
      if (ggufs.length) return ggufs[0].abs;
    }
  } catch (_) { /* segue */ }
  return legado;
}
const MODELO = descobrirModelo();
function rpc(filho, cmd, carga={}, t=120000){return new Promise((res,rej)=>{const id=Math.floor(Math.random()*1e9);const timer=setTimeout(()=>{filho.off('message',h);rej(new Error('timeout '+cmd))},t);function h(m){if(m&&m.id===id){clearTimeout(timer);filho.off('message',h);res(m)}}filho.on('message',h);filho.send({id,cmd,...carga})})}
const filho = fork(WORKER, [], {stdio:['ignore','pipe','pipe','ipc']});
filho.stdout?.on('data',d=>process.stdout.write('[w] '+d));
filho.stderr?.on('data',d=>process.stderr.write('[w-err] '+d));
await new Promise((res,rej)=>{const tm=setTimeout(()=>rej(new Error('sem pronto')),60000);filho.on('message',m=>{if(m&&m.cmd==='pronto'&&m.id==null){clearTimeout(tm);res()}})});
console.log('worker pronto');
console.log('modelo:', MODELO);
const init = await rpc(filho,'init',{mock:false,modelPath:MODELO},300000);
console.log('init',init);
const sistema = 'Você é a Aurinha, assistente do Aurum Tax NCM. Responda em português, curto (1-3 linhas), simpático. Nunca invente códigos, valores ou artigos de lei.';
for (const p of ['Oi, tudo bem?', 'Boa tarde!', 'Obrigado!']) {
  const t0=Date.now();
  const r = await rpc(filho,'conversar',{pergunta:p,sistema,historico:[],think:false,maxTokens:200,temperature:0.5});
  console.log('---',p,'=>',JSON.stringify(r).slice(0,1200),'ms='+(Date.now()-t0));
}
await rpc(filho,'encerrar',{},15000).catch(()=>null);
filho.kill();
