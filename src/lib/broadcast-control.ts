/**
 * Fernsteuerung der Sendeseite fuer Bitfocus Companion.
 *
 * Der Sender ist eine Browser-Seite und laesst sich von aussen nicht direkt
 * bedienen. Companion schickt daher Befehle an `/api/control`, die hier
 * hinterlegt werden; die offene Broadcast-Seite fragt sie ab und fuehrt sie
 * aus. Die Seite meldet ihren tatsaechlichen Zustand zurueck, damit Companion
 * seine Tasten einfaerben kann.
 *
 * Bewusst nur im Arbeitsspeicher: Die Befehle sind fluechtig und ergeben nach
 * einem Neustart ohnehin keinen Sinn mehr - dann ist auch die Sendeseite weg.
 */

export type ControlAction = "start" | "pause" | "resume" | "stop";

/** Was die Sendeseite gerade tatsaechlich tut. */
export interface BroadcastState {
  /** Sendeseite ist offen und meldet sich. */
  connected: boolean;
  /** Mindestens ein Eingang ist aktiv. */
  sending: boolean;
  /** Ton ist angehalten (Session laeuft weiter). */
  paused: boolean;
  /** Zeitpunkt der letzten Rueckmeldung. */
  reportedAt: number;
}

interface ControlEntry {
  /** Zaehler, damit die Seite neue Befehle erkennt, auch wenn derselbe
   *  Befehl zweimal hintereinander kommt. */
  seq: number;
  action: ControlAction | null;
  issuedAt: number;
  state: BroadcastState;
}

/**
 * Wenn sich die Sendeseite laenger als das nicht meldet, gilt sie als weg.
 * Sie meldet sich im Sekundentakt, drei verpasste Runden sind also deutlich.
 */
const ABMELDEFRIST_MS = 5000;

const globalForControl = globalThis as unknown as {
  broadcastControlStore?: Map<string, ControlEntry>;
};

function store(): Map<string, ControlEntry> {
  if (!globalForControl.broadcastControlStore) {
    globalForControl.broadcastControlStore = new Map();
  }
  return globalForControl.broadcastControlStore;
}

function leererEintrag(): ControlEntry {
  return {
    seq: 0,
    action: null,
    issuedAt: 0,
    state: { connected: false, sending: false, paused: false, reportedAt: 0 },
  };
}

function eintrag(sessionId: string): ControlEntry {
  const s = store();
  let e = s.get(sessionId);
  if (!e) {
    e = leererEintrag();
    s.set(sessionId, e);
  }
  return e;
}

/** Legt einen Befehl fuer die Sendeseite ab. */
export function befehlSetzen(sessionId: string, action: ControlAction): ControlEntry {
  const e = eintrag(sessionId);
  e.seq += 1;
  e.action = action;
  e.issuedAt = Date.now();
  console.log(
    `[BroadcastControl] Befehl "${action}" fuer Session ${sessionId} (seq ${e.seq})`
  );
  return e;
}

/** Rueckmeldung der Sendeseite ueber ihren tatsaechlichen Zustand. */
export function zustandMelden(
  sessionId: string,
  state: { sending: boolean; paused: boolean }
): void {
  const e = eintrag(sessionId);
  e.state = {
    connected: true,
    sending: state.sending,
    paused: state.paused,
    reportedAt: Date.now(),
  };
}

/** Aktueller Befehl und Zustand. */
export function statusLesen(sessionId: string): ControlEntry {
  const e = eintrag(sessionId);
  // `connected` wird nicht gespeichert, sondern aus dem Alter der letzten
  // Rueckmeldung abgeleitet - sonst bliebe es nach dem Schliessen des Tabs
  // faelschlich auf true stehen.
  const frisch = Date.now() - e.state.reportedAt < ABMELDEFRIST_MS;
  return {
    ...e,
    state: {
      ...e.state,
      connected: frisch,
      sending: frisch ? e.state.sending : false,
      paused: frisch ? e.state.paused : false,
    },
  };
}

/** Raeumt den Eintrag ab, etwa wenn die Session beendet wird. */
export function eintragEntfernen(sessionId: string): void {
  store().delete(sessionId);
}
