# Graph Report - pb-med-postgres-backup  (2026-09-30)

## Corpus Check
- 18 files · ~4,782 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 4, .mdc 1, .example 1)

## Summary
- 125 nodes · 145 edges · 12 communities (9 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2500aa48`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.js
- pb-med-postgres-backup — CLAUDE.md
- package.json
- pb-med-postgres-backup
- Operaciones
- Graphify Explorer Pro — pb-med-postgres-backup (Ops)
- Campaigns CRM — contrato de restore del servicio de backups
- Q: Backup service restore contract
- config.test.js
- graphify-post-commit.sh
- graphify-session-context.sh
- install-graphify-pro.sh

## God Nodes (most connected - your core abstractions)
1. `pb-med-postgres-backup — CLAUDE.md` - 14 edges
2. `pb-med-postgres-backup` - 10 edges
3. `Operaciones` - 8 edges
4. `Graphify Explorer Pro — pb-med-postgres-backup (Ops)` - 7 edges
5. `Backup Operations — pb-med-postgres-backup` - 7 edges
6. `config` - 5 edges
7. `scripts` - 4 edges
8. `dumpAndUpload()` - 4 edges
9. `runScheduledBackup()` - 4 edges
10. `Troubleshooting` - 4 edges

## Surprising Connections (you probably didn't know these)
- `runScheduledBackup()` --calls--> `dumpAndUpload()`  [EXTRACTED]
  src/server.js → src/backup.js
- `runScheduledBackup()` --calls--> `cleanOldBackups()`  [EXTRACTED]
  src/server.js → src/retention.js

## Import Cycles
- None detected.

## Communities (12 total, 3 thin omitted)

### Community 0 - "server.js"
Cohesion: 0.15
Nodes (16): @aws-sdk/client-s3, buildKey(), dumpAndUpload(), getLatestBackupUrl(), listBackups(), s3, streamDump(), config (+8 more)

### Community 1 - "pb-med-postgres-backup — CLAUDE.md"
Cohesion: 0.13
Nodes (14): Arquitectura, Comandos, Convenciones de código, Cron schedule, Estructura, Formato de backup, Infraestructura Railway, Modos de operación (+6 more)

### Community 2 - "package.json"
Cohesion: 0.11
Nodes (17): dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, express, node-cron, description, main, name (+9 more)

### Community 3 - "pb-med-postgres-backup"
Cohesion: 0.18
Nodes (10): Arquitectura, Deploy en Railway, Desarrollo local, Endpoints, Jira, pb-med-postgres-backup, Restaurar backup, Stack (+2 more)

### Community 4 - "Operaciones"
Cohesion: 0.11
Nodes (17): 502 en health, Backup Operations — pb-med-postgres-backup, Backup timeout, Cambiar schedule, Descargar ultimo backup, Forzar limpieza, Health check (sin auth), Informacion del servicio (+9 more)

### Community 6 - "Graphify Explorer Pro — pb-med-postgres-backup (Ops)"
Cohesion: 0.25
Nodes (7): Cuándo invocar, Formato de reporte, Graphify Explorer Pro — pb-med-postgres-backup (Ops), Instrucciones, Prerequisito, Repos relacionados, Restricciones

### Community 8 - "Campaigns CRM — contrato de restore del servicio de backups"
Cohesion: 0.40
Nodes (4): Campaigns CRM — contrato de restore del servicio de backups, Límite de responsabilidad, Propiedades verificables, Superficie operativa

### Community 9 - "Q: Backup service restore contract"
Cohesion: 0.50
Nodes (3): Answer, Q: Backup service restore contract, Source Nodes

### Community 10 - "config.test.js"
Cohesion: 0.16
Nodes (6): { server, cronTask }, execFileAsync, loadConfig(), root, VALID_ENV, ./src/config.js

## Knowledge Gaps
- **70 isolated node(s):** `graphify-session-context.sh script`, `install-graphify-pro.sh script`, `name`, `version`, `description` (+65 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 84 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `node-cron` connect `package.json` to `server.js`, `config.test.js`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **What connects `graphify-session-context.sh script`, `install-graphify-pro.sh script`, `name` to the rest of the system?**
  _70 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pb-med-postgres-backup — CLAUDE.md` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Should `Operaciones` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._