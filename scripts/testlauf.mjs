/**
 * Startet den Server fuer einen Testlauf und schneidet das Log mit.
 *
 * Warum nicht einfach `npm start`:
 *  - Next schreibt keine Zeitstempel. Ohne die laesst sich "Laufzeit bis zum
 *    ersten Reconnect" nicht bestimmen.
 *  - Die Gemini-WebSocket-URL enthaelt den API-Key als Query-Parameter.
 *    Fehlerobjekte koennen die URL mitfuehren. Dieses Skript redigiert das,
 *    damit ein Logfile gefahrlos weitergegeben werden kann.
 *
 * Aufruf:   node scripts/testlauf.mjs
 * Beenden:  Strg+C  -> danach erscheint die Auswertung
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

const start = Date.now();
// Lokale Zeit, nicht UTC: Das Team vergleicht den Dateinamen mit der Uhr an der Wand.
const d0 = new Date();
const p2 = (n) => String(n).padStart(2, "0");
const stamp =
  `${d0.getFullYear()}-${p2(d0.getMonth() + 1)}-${p2(d0.getDate())}` +
  `-${p2(d0.getHours())}${p2(d0.getMinutes())}`;
mkdirSync("logs", { recursive: true });
const logPath = join("logs", `testlauf-${stamp}.log`);
const out = createWriteStream(logPath, { flags: "a" });

/** Entfernt Secrets aus einer Logzeile. */
function redact(line) {
  return line
    .replace(/([?&]key=)[^&\s"']+/gi, "$1<REDIGIERT>")
    .replace(/(AIza)[A-Za-z0-9_\-]{10,}/g, "$1<REDIGIERT>")
    .replace(/("?(api[_-]?key|secret|token|password)"?\s*[:=]\s*"?)([^",\s]{8,})/gi, "$1<REDIGIERT>");
}

const events = { reconnects: [], gaps: [], goAways: [] };

function elapsed(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function handle(line) {
  if (!line.trim()) return;
  const ms = Date.now() - start;
  const clean = redact(line);
  const prefixed = `[${new Date().toTimeString().slice(0, 8)}] [+${elapsed(ms)}] ${clean}`;
  out.write(prefixed + "\n");

  let marker = "";
  if (/Received goAway/.test(clean)) {
    events.goAways.push(ms);
    marker = "  <<< GOAWAY";
  } else if (/Reconnecting Gemini WebSocket with handle/.test(clean)) {
    const mitHandle = !/handle:\s*none/.test(clean);
    events.reconnects.push({ ms, mitHandle });
    marker = `  <<< RECONNECT #${events.reconnects.length} (Handle: ${mitHandle ? "ja" : "NEIN"})`;
  } else if (/Audio resumed after (\d+)ms gap/.test(clean)) {
    const gapMs = Number(clean.match(/Audio resumed after (\d+)ms gap/)[1]);
    events.gaps.push({ ms, gapMs });
    marker = `  <<< AUDIO-LUECKE ${(gapMs / 1000).toFixed(1)} s${gapMs > 3000 ? "  *** UEBER 3 s ***" : ""}`;
  }
  console.log(prefixed + marker);
}

const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(cmd, ["start"], { shell: process.platform === "win32" });

let rest = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (d) => {
    const parts = (rest + d.toString()).split(/\r?\n/);
    rest = parts.pop();
    parts.forEach(handle);
  });
}

function summary() {
  const total = Date.now() - start;
  const lines = [
    "",
    "=".repeat(60),
    `AUSWERTUNG  (Gesamtlaufzeit ${elapsed(total)})`,
    "=".repeat(60),
    `goAway-Meldungen:    ${events.goAways.length}`,
    `Reconnects:          ${events.reconnects.length}`,
  ];
  if (events.reconnects.length) {
    lines.push(`Erster Reconnect bei: +${elapsed(events.reconnects[0].ms)}`);
    events.reconnects.forEach((r, i) =>
      lines.push(`  #${i + 1} bei +${elapsed(r.ms)}, Resumption-Handle: ${r.mitHandle ? "vorhanden" : "FEHLT"}`)
    );
  } else {
    lines.push("Erster Reconnect:    keiner aufgetreten");
  }
  lines.push(`Audio-Luecken > 2 s: ${events.gaps.length}`);
  events.gaps.forEach((g) =>
    lines.push(`  bei +${elapsed(g.ms)}: ${(g.gapMs / 1000).toFixed(1)} s${g.gapMs > 3000 ? "  *** UEBER 3 s ***" : ""}`)
  );
  const max = events.gaps.reduce((m, g) => Math.max(m, g.gapMs), 0);
  lines.push(`Groesste Luecke:     ${max ? (max / 1000).toFixed(1) + " s" : "keine"}`);
  lines.push(`Logdatei:            ${logPath}`);
  lines.push("=".repeat(60));
  const text = lines.join("\n");
  console.log(text);
  out.write(text + "\n");
}

let done = false;
function finish() {
  if (done) return;
  done = true;
  summary();
  out.end(() => process.exit(0));
}

process.on("SIGINT", () => { child.kill(); setTimeout(finish, 300); });
child.on("exit", finish);
