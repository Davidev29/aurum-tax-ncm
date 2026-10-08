/**
 * Gera `prisma/schema.sql` (DDL) + `src/infrastructure/db/schema-sql.ts`
 * (mesmo DDL embarcado como string) a partir do `prisma/schema.prisma`.
 *
 * O DDL embarcado é o que cria as tabelas no `<userData>/aurum.db` em
 * instalações limpas (bootstrap em runtime — ver `prisma-no.ts`).
 * Rode via `npm run db:generate` (sempre após editar o schema).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = process.cwd()
const URL = 'file:./prisma/dev.db'

const sql = execFileSync(
  process.execPath,
  [
    join('node_modules', 'prisma', 'build', 'index.js'),
    'migrate',
    'diff',
    '--from-empty',
    '--to-schema-datamodel',
    join('prisma', 'schema.prisma'),
    '--script',
  ],
  { cwd: raiz, env: { ...process.env, DATABASE_URL: URL }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
)

writeFileSync(join(raiz, 'prisma', 'schema.sql'), sql)

const ts =
  '/**\n' +
  ' * DDL embarcado — GERADO por `scripts/gerar-schema-sql.mjs` (`npm run db:generate`).\n' +
  ' * NÃO edite à mão: é a saída de `prisma migrate diff` do schema atual e\n' +
  ' * cria as tabelas em instalações limpas (bootstrap em runtime).\n' +
  ' */\n' +
  `export const SCHEMA_SQL: string = ${JSON.stringify(sql)}\n`
writeFileSync(join(raiz, 'src', 'infrastructure', 'db', 'schema-sql.ts'), ts)
console.log(`schema.sql + schema-sql.ts gerados (${sql.length} caracteres)`)
