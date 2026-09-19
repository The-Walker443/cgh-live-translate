# Anpassungen gegenüber dem Upstream

Dieses Dokument richtet sich an den **nächsten Entwickler** und an alle, die
später ein `git pull` vom Upstream machen wollen.

Upstream: <https://github.com/google-gemini/gemini-live-translate-livekit>
Basis-Commit: `26d9a62`
Arbeitsbranch: `gemeinde` — `main` bleibt unverändert auf Upstream-Stand.

Grundsatz: minimal-invasive Diffs. Jede Änderung unten hat eine Begründung.
Was suboptimal erscheint, aber funktioniert, wurde notiert statt umgebaut.

---

## Stand

Phase 1 ist abgeschlossen. **Phase 2 (T-01 bis T-08) ist bewusst noch nicht
begonnen:** Zuerst läuft T-10 am unveränderten Upstream, weil das der einzige
Test ist, der das Projekt kippen kann, und weil er so eine saubere
Vergleichsbasis für alle späteren Änderungen liefert.

| Was | Stand |
| :--- | :--- |
| Repo geklont, Branch `gemeinde` | ✅ |
| Node 22.23.2, Abhängigkeiten installiert | ✅ |
| Baseline-Build des unveränderten Upstream | ✅ grün |
| Smoke-Test, serverseitig | ✅ bestanden (siehe `TESTPROTOKOLL.md`) |
| Smoke-Test, Audioweg im Browser | offen — wird im ersten T-10-Lauf abgehakt |
| T-10 (Go/No-go) | vorbereitet, Durchführung steht aus |
| Phase 2 | nicht begonnen |

---

## Geänderte und neue Dateien

| Datei | Art | Begründung |
| :--- | :--- | :--- |
| `src/config/gemeinde.ts` | **neu** | Gemeinde-spezifische Sprachliste, native Anzeigenamen und feste Session-ID. Bewusst eine eigene Datei, damit `src/lib/languages.ts` (Upstream) unangetastet bleibt. Noch von nichts importiert — wird in T-05/T-06 verdrahtet. |
| `.env.local` | **neu, nicht im Git** | Lokale Konfiguration. Durch `.gitignore` (`.env*`) ausgeschlossen. |
| `ANPASSUNGEN.md` | **neu** | Dieses Dokument. |
| `TESTPROTOKOLL.md` | **neu** | Testprotokoll und Ergebnisse. Enthält den Ablauf für T-10. |
| `T10-BEWERTUNGSBOGEN.md` | **neu** | Einseitiger Bogen zum Ausdrucken für die Muttersprachler in T-10. |
| `scripts/testlauf.mjs` | **neu** | Startet den Server für Testläufe. Next schreibt keine Zeitstempel — ohne die lässt sich „Laufzeit bis zum ersten Reconnect" nicht bestimmen. Erkennt goAway, Reconnects und Audio-Lücken und fasst sie beim Beenden zusammen. **Redigiert außerdem Secrets**, weil die Gemini-WebSocket-URL den API-Key als Query-Parameter enthält und Fehlerobjekte die URL mitführen können — ein Logfile soll gefahrlos weitergegeben werden können. |
| `scripts/demo-sender.mjs` | **neu** | Speist eine Audiodatei direkt als Sender in den LiveKit-Raum ein, statt sie über die Broadcast-Seite per Tab-Audio zu teilen. Wer bewertet, kann nicht gleichzeitig den Browser bedienen und konzentriert zuhören. Wartet auf die Bridge, bevor die Wiedergabe startet, und liefert allen Läufen bitidentisches Material ab derselben Sekunde. |
| `DEPLOYMENT.md` | **neu** | Anleitung für die Bereitstellung per Docker Compose. |
| `.github/workflows/docker.yml` | **neu** | Prüft Typen und Build, baut danach ein Multi-Arch-Image (amd64 + arm64) und veröffentlicht es nach GHCR. Ziel: Auf dem Server genügen `docker-compose.yml` und `.env`. |
| `docker-compose.yml` | **neu** | Bereitstellung aus dem fertigen Image. Enthält zusätzlich einen abgeschalteten Dienst für selbst gehostetes LiveKit als Ausbaustufe. |
| `.env.example` | **neu** | Vorlage für die `.env` auf dem Server. Enthält keine Werte. |
| `Dockerfile` | **1 Zeile ergänzt** | `ENV HOSTNAME=0.0.0.0`. Docker setzt `HOSTNAME` auf die Container-ID, und der Standalone-Server von Next liest genau diese Variable (`process.env.HOSTNAME \|\| '0.0.0.0'`). Ohne die Zeile bindet er auf den Container-Namen statt auf alle Interfaces. |
| `.dockerignore` | **erweitert** | `.env.local` zu `.env*` verallgemeinert, damit auch `.env` und `.env.production` nie ins Image geraten. `logs` ergänzt. |
| `.gitignore` | **ergänzt** | `/logs` — Testlauf-Logs gehören nicht ins Repository. Dazu `!.env.example`: Das vorhandene Muster `.env*` hätte sonst auch die Vorlage ausgeschlossen, die eingecheckt werden muss. |

### Bewusst unverändert gelassen

- `src/lib/languages.ts` — die über 70 Sprachen bleiben stehen. Die Einschränkung
  auf die Gemeinde-Auswahl läuft über den vorhandenen `allowedLanguages`-
  Mechanismus, nicht durch Löschen von Einträgen.
- `package-lock.json` — `npm install` hatte nur `peer`-Metadaten umsortiert,
  ohne Versionsänderung. Zurückgesetzt, um den Diff sauber zu halten.

---

## Branches und CI

`main` und `gemeinde` zeigen auf denselben Stand. `main` ist der Standardbranch
und liefert den `latest`-Tag des Images; `gemeinde` bleibt als Arbeitsbranch
bestehen. Der ursprüngliche Plan, `main` dauerhaft auf dem reinen
Upstream-Stand zu halten, wurde damit aufgegeben — die Vergleichsbasis liefert
stattdessen das Remote `upstream`, das weiterhin auf das Google-Repository
zeigt (`git diff upstream/main`).

**Lint läuft bewusst nur über `src/config` und `scripts`.** Der Upstream hat 17
offene Lint-Befunde, überwiegend `any`-Typen in `broadcast/page.tsx`,
`watch/page.tsx` und `api/sessions/route.ts`. Sie werden **nicht behoben**: Das
wären Änderungen an Upstream-Dateien, die bei jedem `git pull` vom Upstream
Konflikte erzeugen. Würde das gesamte Projekt gelintet, produzierte jeder
CI-Lauf 17 Annotationen, die niemand mehr liest — und ein echter Fehler in
eigenem Code ginge darin unter. Die **Typprüfung** läuft dagegen unverändert
über das gesamte Projekt; die ist upstream sauber.

---

## Entscheidungen, die den Code betreffen

### LiveKit Cloud ist Entwicklung, nicht Zielarchitektur

Für Entwicklung und Feldtest läuft LiveKit Cloud (Build-Stufe, kostenlos),
weil auf dem Entwicklungsrechner kein Docker installiert ist. **Für den
Regelbetrieb ist selbst gehostetes LiveKit auf der Gemeinde-NAS vorgesehen**
(Apache-2.0, kostenlos).

Daraus folgt eine harte Regel für allen künftigen Code:

> Nichts bauen, was an LiveKit Cloud gebunden ist. Keine Cloud-spezifischen
> APIs, keine Annahmen über TLS-Terminierung, keine hartkodierten URLs.

Der Wechsel ist dann reine Konfiguration — drei Werte in `.env.local`.

**Merksatz:** `LIVEKIT_URL` ist immer die Adresse aus Sicht des
Besucher-Handys, nicht aus Sicht des Servers. Bei Betrieb auf der NAS steht
dort niemals `localhost`.

**Kontingent Build-Stufe:** 5.000 WebRTC-Teilnehmerminuten pro Monat, gezählt
wird jede verbundene Minute jedes Teilnehmers — Hörer, Sender und
Übersetzer-Bots gleichermaßen. Ein Feldtest mit 20 Hörern über eine Stunde
verbraucht rund 1.380 Minuten. Für Entwicklung und zwei bis drei Testläufe mit
Publikum reicht das; darüber hinaus wird nicht abgerechnet, sondern
abgeschaltet.

### Der eigentliche Aufwand des NAS-Umzugs sind die Zertifikate

LiveKit Cloud liefert eine fertige `wss://`-URL. **Beim Umzug auf selbst
gehostetes LiveKit fällt die weg.** Dann brauchen *beide* ein Zertifikat: die
App und der LiveKit-Server. Das ist der eigentliche Aufwand des Umzugs — nicht
das Docker-Setup, das oft dafür gehalten wird.

### Was LiveKit Cloud bei T-07 nicht erledigt

Die `wss://`-URL sichert nur den **Medientransport**. Die App selbst wird
weiterhin von `localhost:3000` ausgeliefert, und genau diese Seite rufen die
Besucher-Handys auf — über die LAN-IP also aus unsicherer Herkunft. T-07
(HTTPS für die App) bleibt davon unberührt bestehen.

Der Gewinn durch Cloud liegt woanders: Der Medienpfad läuft nicht mehr durchs
Gemeindenetz, wodurch **Client-Isolation und VLAN-Trennung im Gäste-WLAN
umgangen** werden. Das ist der Grund, warum Cloud den Feldtest erleichtert —
nicht das Zertifikat.

---

## Datenschutz

Solange LiveKit Cloud genutzt wird, **verlässt Predigtaudio das Gemeindenetz
zweifach**:

1. Das Originalaudio läuft über die LiveKit-Server.
2. Die Übersetzung zusätzlich über Google.

Regions-Pinning bietet LiveKit erst in der höchsten Preisstufe an — eine
Zusicherung auf EU-Verarbeitung ist auf der Build-Stufe **nicht möglich**.

Mit selbst gehostetem LiveKit entfällt der erste Weg wieder. Das ist ein
weiteres Argument für den Umzug nach dem Feldtest.

Unabhängig davon gilt: Bei Gemini Paid Tier werden die Daten nicht zur
Produktverbesserung genutzt, die Verarbeitung findet aber statt. Ein Hinweis
auf der Hörerseite und im Gottesdienst ist angemessen.

---

## Offene Punkte

- **Modell im Preview-Status.** `gemini-3.5-live-translate-preview` — Google
  kann Verhalten, Preise und Verfügbarkeit ändern. Kein Verlass auf
  unveränderte Funktion über Monate. Die Gemeinde sollte einen manuellen
  Plan B für Besucher haben, die auf Übersetzung angewiesen sind.
- **Messergebnisse** aus dem Testprotokoll werden hier ergänzt, sobald die
  Tests gelaufen sind (insbesondere T-03 `contextWindowCompression`,
  T-13 iPhone-Sperrbildschirm, T-16 `systemInstruction`).
