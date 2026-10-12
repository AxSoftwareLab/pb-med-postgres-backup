---
name: backup-operations
description: Operaciones comunes del microservicio de backups PostgreSQL de Paintball Medellin. Incluye trigger manual, descarga, restauracion, cambio de schedule y monitoreo.
triggers:
  - backup
  - restaurar
  - pg_dump
  - pg_restore
  - descargar backup
  - backup manual
  - schedule
  - retencion
---

# Backup Operations — pb-med-postgres-backup

## Informacion del servicio

- **URL:** `https://pb-med-postgres-backup-production.up.railway.app`
- **Auth:** Bearer token (variable `SECRET_TOKEN` en Railway)
- **Schedule:** Lunes 2:00 AM Colombia (`0 7 * * 1` UTC)
- **Bucket:** `pb-med-backups` (Railway S3)
- **Formato:** `pg_dump -Fc` (formato custom PostgreSQL, extension `.dump`)
- **Retencion:** 30 dias

## Operaciones

### Health check (sin auth)

```bash
curl https://pb-med-postgres-backup-production.up.railway.app/health
```

Respuesta: `{ "status": "ok", "mode": "server" }`. No consulta el bucket; para ver los backups usar `GET /backup/list` con `Authorization: Bearer`. El token por query string no se acepta.

### Trigger backup manual

```bash
curl -X POST -H "Authorization: Bearer $SECRET_TOKEN" \
  https://pb-med-postgres-backup-production.up.railway.app/backup/trigger
```

Respuesta: `{ "key": "postgres/pb-med-prod-...", "size": 972137, "timestamp": "...", "cleanup": { ... } }`

### Descargar ultimo backup

```bash
curl -L -H "Authorization: Bearer $SECRET_TOKEN" \
  https://pb-med-postgres-backup-production.up.railway.app/backup/latest \
  -o latest.dump
```

### Stream directo de pg_dump

```bash
curl -H "Authorization: Bearer $SECRET_TOKEN" \
  https://pb-med-postgres-backup-production.up.railway.app/backup \
  -o backup.dump
```

### Listar backups

```bash
curl -H "Authorization: Bearer $SECRET_TOKEN" \
  https://pb-med-postgres-backup-production.up.railway.app/backup/list
```

### Forzar limpieza

```bash
curl -X DELETE -H "Authorization: Bearer $SECRET_TOKEN" \
  https://pb-med-postgres-backup-production.up.railway.app/backup/cleanup
```

### Restaurar backup localmente

```bash
pg_restore -d "postgresql://user:pass@localhost:5432/pb_local" \
  --no-owner --no-acl --clean --if-exists latest.dump
```

Para ver el contenido sin restaurar:

```bash
pg_restore -l latest.dump
```

## Cambiar schedule

1. Editar `CRON_SCHEDULE` en Railway (`railway variables set 'CRON_SCHEDULE=...'`)
2. Tambien actualizar el default en `src/config.js` para que coincida
3. Redeploy: `railway up --detach` o push a GitHub
4. Verificar en logs: `railway logs` — debe mostrar `Cron scheduled: "..." (Medellín / America/Bogota)`

Expresiones cron comunes:

| Schedule | Expresion (UTC) | Colombia |
|----------|-----------------|----------|
| Diario 2AM COT | `0 7 * * *` | 2:00 AM |
| Lunes 2AM COT | `0 7 * * 1` | Lunes 2:00 AM |
| Cada 12h | `0 */12 * * *` | Cada 12 horas |
| Viernes 3AM COT | `0 8 * * 5` | Viernes 3:00 AM |

## Ver logs

```bash
cd /home/ax-software/Documentos/GitHub/pb-med-postgres-backup
railway logs
```

## Obtener SECRET_TOKEN

```bash
cd /home/ax-software/Documentos/GitHub/pb-med-postgres-backup
railway variables list --json | python3 -c "import sys,json; print(json.load(sys.stdin)['SECRET_TOKEN'])"
```

## Troubleshooting

### pg_dump version mismatch
Si la DB se actualiza a una nueva version de PostgreSQL, actualizar `ARG PG_VERSION=XX` en el Dockerfile.

### Backup timeout
Los backups son rapidos (~1 segundo para ~1MB). Si crecen, considerar gzip compresion.

### 502 en health
El servicio puede estar re-deployando. Esperar 1-2 minutos y reintentar.
