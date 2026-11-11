-- ==============================================================================
-- SecurityOps 2.0 - Migration 004
-- Operationale DELETE-Rechte für veränderbare Einsatztabellen
-- ==============================================================================
-- Hintergrund:
--   Migration 001 vergibt secops_app_user lediglich SELECT, INSERT, UPDATE und
--   entzieht DELETE anschließend explizit für die append-only Tabellen
--   (guardbook_entries, guardbook_revisions, patrol_scans, shift_handovers).
--   Die Sync-Engine führt für Schichten und Aufgaben jedoch versionsgesicherte
--   DELETE-Operationen aus. Ohne DELETE auf genau diesen beiden Tabellen
--   enden diese Sync-Pfade mit "permission denied for table shifts/tasks".
--
--   Es werden ausschließlich die veränderbaren operativen Tabellen freigegeben.
--   Die revisionssicheren Tabellen bleiben unverändert unlöschbar; RLS-Policies
--   und Trigger gelten weiterhin unverändert.

GRANT DELETE ON shifts, tasks TO secops_app_user;
