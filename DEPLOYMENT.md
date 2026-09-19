# Bereitstellung per Docker

Ziel: Auf dem Server liegen am Ende **nur zwei Dateien** — `docker-compose.yml`
und `.env`. Kein Quellcode, kein Node, kein Build. Das Image baut GitHub.

```
Push auf Branch gemeinde
        ↓
GitHub Action: prüft Typen, baut, veröffentlicht Image nach GHCR
        ↓
Server: docker compose pull && docker compose up -d
```

---

## Teil 1 — Einmalig: Repository einrichten

Das Repository zeigt nach dem Klonen noch auf das Original von Google. Das
eigene Repository kommt als zusätzliches Remote dazu, damit ein späteres
`git pull` vom Upstream weiterhin möglich bleibt.

```bash
# Upstream unter eigenem Namen behalten
git remote rename origin upstream

# Eigenes Repository als neues origin eintragen
git remote add origin https://github.com/<benutzer>/<repo>.git

# Branch gemeinde hochladen
git push -u origin gemeinde
```

> **Nicht nach `upstream` pushen.** Das ist das öffentliche Google-Repository.

Sobald der Push durch ist, läuft die Action automatisch. Zu sehen unter
*Actions* im Repository. Beim ersten Lauf dauert sie einige Minuten, weil zwei
Architekturen gebaut werden (amd64 und arm64) und der Cache noch leer ist.

### Sichtbarkeit des Images

Images in der GitHub Container Registry sind **standardmäßig privat**. Das ist
der häufigste Stolperstein beim ersten `docker compose pull`.

Zwei Möglichkeiten:

**a) Image öffentlich machen** — am einfachsten, wenn der Inhalt unkritisch ist.
Im Repository unter *Packages* das Paket auswählen → *Package settings* →
*Change visibility* → *Public*. Es enthält keine Zugangsdaten; die kommen erst
zur Laufzeit aus der `.env`.

**b) Image privat lassen** — dann muss sich der Server anmelden. Dazu ein
Personal Access Token (classic) mit der Berechtigung `read:packages` anlegen
und auf dem Server einmalig:

```bash
echo "<token>" | docker login ghcr.io -u <benutzer> --password-stdin
```

---

## Teil 2 — Auf dem Server

Nur diese beiden Dateien werden gebraucht:

```bash
mkdir -p /volume1/docker/live-uebersetzung
cd /volume1/docker/live-uebersetzung

# docker-compose.yml und .env.example aus dem Repository herunterladen
curl -O https://raw.githubusercontent.com/<benutzer>/<repo>/gemeinde/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/<benutzer>/<repo>/gemeinde/.env.example
```

Danach die `.env` ausfüllen. Mindestens:

| Variable | Bedeutung |
| :--- | :--- |
| `IMAGE` | `ghcr.io/<benutzer>/<repo>:latest` |
| `APP_PORT` | Port auf dem Server, Standard 8080 |
| `LIVEKIT_API_KEY` / `_SECRET` / `_URL` | LiveKit-Zugangsdaten |
| `GEMINI_API_KEY` | Muss aus einem Paid-Tier-Projekt stammen |
| `BROADCAST_PASSWORD` | Schutz der Sender-Seite |

Starten:

```bash
docker compose pull
docker compose up -d
docker compose logs -f
```

Prüfen, ob es läuft:

```bash
curl http://localhost:8080/api/auth/status
# erwartet: {"passwordRequired":true}
```

Der Container hat einen Healthcheck; `docker compose ps` zeigt `healthy`,
sobald die App antwortet.

### Aktualisieren

```bash
docker compose pull && docker compose up -d
```

Die Action schreibt bei jedem Lauf in die Zusammenfassung, welche Tags
veröffentlicht wurden. Wer nicht immer `latest` will, setzt in der `.env` einen
festen Tag, etwa `IMAGE=ghcr.io/<benutzer>/<repo>:sha-1a2b3c4`.

---

## Teil 3 — Was damit noch nicht erledigt ist

### HTTPS für die App (T-07)

Der Container liefert **HTTP** aus. Das genügt für einen Test im lokalen Netz
per `localhost`, **nicht** für Besucher-Handys: Browser behandeln nur
`localhost` als sicheren Kontext. Über die LAN-IP ist `getUserMedia` gesperrt
und der WebRTC-Empfangspfad unzuverlässig.

Für den Betrieb gehört daher ein Reverse Proxy mit Zertifikat davor — auf einer
Synology etwa der eingebaute Reverse Proxy plus Let's Encrypt, alternativ Caddy
oder Traefik im selben Compose-Verbund.

Dass LiveKit Cloud bereits eine `wss://`-URL liefert, ersetzt das **nicht**:
Das betrifft nur den Medientransport, nicht die Auslieferung der Seite.

### Selbst gehostetes LiveKit

In der `docker-compose.yml` ist ein Dienst `livekit` unter dem Profil `livekit`
vorbereitet, aber standardmäßig aus. Er ist **nicht schlüsselfertig**; vorher zu
klären sind Zertifikat, UDP-Portbereich im Router und eigene Schlüssel. Details
stehen als Kommentar in der Datei und in `ANPASSUNGEN.md`.

Merksatz: `LIVEKIT_URL` ist immer die Adresse aus Sicht des Besucher-Handys,
niemals `localhost`.

### Datenschutz

Solange LiveKit Cloud genutzt wird, verlässt Predigtaudio das Gemeindenetz
zweifach — über LiveKit und über Google. Siehe `ANPASSUNGEN.md`.

---

## Stolpersteine

| Symptom | Ursache | Lösung |
| :--- | :--- | :--- |
| `denied` beim `docker compose pull` | Image ist privat | Sichtbarkeit umstellen oder `docker login ghcr.io` (Teil 1) |
| `IMAGE muss gesetzt sein` | `.env` fehlt oder `IMAGE` ist leer | `.env` neben die `docker-compose.yml` legen |
| Container läuft, aber nicht erreichbar | Portkonflikt auf dem Server | `APP_PORT` in der `.env` ändern |
| `no matching manifest` | Falsche CPU-Architektur | Die Action baut amd64 und arm64; prüfen, ob der Lauf durchlief |
| Hörer bekommt keinen Ton | App per HTTP über LAN-IP aufgerufen | HTTPS einrichten, siehe T-07 |
