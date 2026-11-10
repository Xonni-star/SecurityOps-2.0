# SecurityOps 2.0 - Backup- und Wiederherstellungskonzept

## 1. Mandantenspezifisches und Gesamtsystem-Backup
1. **Tägliches Volldump**:
   ```bash
   pg_dump -U secops_admin -h localhost -d securityops_v2 -F c -b -v -f /var/backups/secops_$(date +%Y%m%d).dump
   ```
2. **Mandantenisoliertes Backup** (via RLS / Table Scans):
   ```bash
   COPY (SELECT * FROM logbook_entries WHERE tenant_id = '11111111-1111-1111-1111-111111111111') TO '/var/backups/tenant_frankfurt_logbook.csv' WITH CSV HEADER;
   ```

## 2. Wiederherstellung & Integritätsprüfung
- Einspielen mit `pg_restore --clean --if-exists -d securityops_v2 /var/backups/secops_YYYYMMDD.dump`.
- Automatische Re-Aktivierung aller RLS Policies nach Restore.
