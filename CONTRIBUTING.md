# Mitwirken und Releases

## Lokale Prüfung

- Backend: im Ordner `frontend/backend` `npm ci`, `npm run build` und `npm test -- --runInBand` ausführen. Die Tests benötigen PostgreSQL 16 sowie die in `src/config/env.ts` beschriebenen Testvariablen.
- Frontend: im Ordner `frontend` `npm ci`, `npm test` und `npm run build` ausführen.
- Produktionskonfiguration: `docker compose -f frontend/deploy/docker-compose.production.yml config --no-interpolate --quiet` und beide Dockerfiles prüfen.
- Keine echten Secrets in `.env.example`, CI, Bundles oder Commits ablegen.

## Release-Prozess

1. `VERSION` und `CHANGELOG.md` aktualisieren.
2. Builds, Tests und CI erfolgreich abschließen.
3. Einen annotierten SemVer-Tag (`vMAJOR.MINOR.PATCH`) auf den geprüften Commit setzen und auf GitHub sowie Forgejo pushen.
4. Release-Einträge auf beiden Hosts mit Installationshinweisen und getesteten Assets veröffentlichen.
5. Tag, Commit, CI-Läufe und SHA-256 der Assets dokumentieren. Bereits veröffentlichte Tags oder Assets nicht überschreiben.
