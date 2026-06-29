/**
 * Design-token + signal system — the keystone of the Ninbus dashboard's visual
 * identity. Encodes OTA/fleet *domain semantics* into a single typed source so
 * every component renders state identically.
 *
 * PRINCIPLE: color and shape are SEMANTIC, never decorative. The dashboard has
 * exactly ONE action accent and a small set of SIGNAL tones, each mapped to a
 * real fleet state. There is no "brand blue everywhere" — the identity is the
 * typography (identifiers in mono), the signal geometry, and the density.
 *
 * Consumed by the `system/*` primitives (`<Signal>`, `<Phase>`, `<Pipeline>`…),
 * which read `tone` and `shape` to render consistent telemetry-style status.
 */

// ── Signal tones ───────────────────────────────────────────────────────
// Five semantic tones. These are the ONLY colors that convey state. Mapped to
// CSS variables defined in globals.css (--signal-*) so dark/light themes share
// one set of class names.
export type SignalTone =
	| 'ok' // green   — healthy: online, completed, installed
	| 'busy' // amber   — active work: in_progress, downloading
	| 'fault' // red     — problem: failed, error, rejected, offline-on-fault
	| 'idle' // neutral — waiting/unknown: pending, offline, suspended
	| 'info'; // cyan    — neutral activity: assigned, downloaded

// ── Signal shapes ──────────────────────────────────────────────────────
// Status reads as a TELEMETRY STRIP, not a tag cloud. A device/connection is a
// dot; a multi-state process (deployment) is a shape that conveys progression.
// This is the single most distinctive anti-generic choice: generic dashboards
// use identical rounded pills for every state.
export type SignalShape = 'dot' | 'ring' | 'square' | 'diamond' | 'slash';

export interface SignalToken {
	tone: SignalTone;
	shape: SignalShape;
	label: string;
	/** `live` => the shape pulses (online dot, downloading bar). */
	live?: boolean;
}

// ── Domain → signal mapping ────────────────────────────────────────────
// THE single source of truth for "what color is this state". Components never
// hardcode status colors — they call the resolver below.

export const DEVICE_SIGNAL: Record<string, SignalToken> = {
	pending: { tone: 'busy', shape: 'ring', label: 'Pendente' },
	accepted: { tone: 'ok', shape: 'dot', label: 'Aceito' },
	rejected: { tone: 'fault', shape: 'slash', label: 'Rejeitado' },
	disabled: { tone: 'idle', shape: 'square', label: 'Desativado' },
};

export const CONNECTION_SIGNAL: Record<string, SignalToken> = {
	// hawkBit pollStatus values
	online: { tone: 'ok', shape: 'dot', label: 'Online', live: true },
	connected: { tone: 'ok', shape: 'dot', label: 'Conectado', live: true },
	offline: { tone: 'idle', shape: 'dot', label: 'Offline' },
	disconnected: { tone: 'idle', shape: 'dot', label: 'Desconectado' },
	unknown: { tone: 'idle', shape: 'ring', label: 'Desconhecido' },
};

export const DEPLOYMENT_SIGNAL: Record<string, SignalToken> = {
	pending: { tone: 'busy', shape: 'ring', label: 'Pendente' },
	in_progress: { tone: 'busy', shape: 'square', label: 'Em andamento', live: true },
	completed: { tone: 'ok', shape: 'dot', label: 'Concluído' },
	failed: { tone: 'fault', shape: 'slash', label: 'Falhou' },
	canceled: { tone: 'idle', shape: 'square', label: 'Cancelado' },
	no_targets: { tone: 'idle', shape: 'ring', label: 'Sem alvos' },
	unknown: { tone: 'idle', shape: 'ring', label: 'Desconhecido' },
};

// ── OTA phase pipeline ─────────────────────────────────────────────────
// A deployment's per-device journey, ordered as a FLOW. This drives the
// signature <Pipeline> component (assigned → downloading → installed), which
// replaces "4 count-up stat cards" with the actual OTA funnel.
export interface PipelineStage {
	phase: string;
	tone: SignalTone;
	label: string;
}

export const DEPLOYMENT_PIPELINE: PipelineStage[] = [
	{ phase: 'assigned', tone: 'info', label: 'Atribuído' },
	{ phase: 'downloading', tone: 'busy', label: 'Baixando' },
	{ phase: 'installing', tone: 'busy', label: 'Instalando' },
	{ phase: 'installed', tone: 'ok', label: 'Instalado' },
];

export const PHASE_SIGNAL: Record<string, SignalToken> = {
	assigned: { tone: 'info', shape: 'dot', label: 'Atribuído' },
	pending: { tone: 'busy', shape: 'ring', label: 'Pendente' },
	downloading: { tone: 'busy', shape: 'square', label: 'Baixando', live: true },
	downloaded: { tone: 'info', shape: 'square', label: 'Baixado' },
	installing: { tone: 'busy', shape: 'diamond', label: 'Instalando', live: true },
	installed: { tone: 'ok', shape: 'dot', label: 'Instalado' },
	error: { tone: 'fault', shape: 'slash', label: 'Erro' },
	canceled: { tone: 'idle', shape: 'square', label: 'Cancelado' },
	unknown: { tone: 'idle', shape: 'ring', label: 'Desconhecido' },
};

// ── Resolvers ──────────────────────────────────────────────────────────

function resolve(
	map: Record<string, SignalToken>,
	key: string | null | undefined,
	fallbackLabel?: string,
): SignalToken {
	if (!key) return { tone: 'idle', shape: 'ring', label: fallbackLabel ?? '—' };
	return map[key] ?? { tone: 'idle', shape: 'ring', label: key };
}

export const deviceSignal = (s: string) => resolve(DEVICE_SIGNAL, s);
export const connectionSignal = (s: string | null | undefined) =>
	resolve(CONNECTION_SIGNAL, s, 'Desconhecido');
export const deploymentSignal = (s: string) => resolve(DEPLOYMENT_SIGNAL, s);
export const phaseSignal = (s: string) => resolve(PHASE_SIGNAL, s);

// ── Tone → CSS classes ─────────────────────────────────────────────────
// Consumed by primitives to apply the semantic background/text/border WITHOUT
// repeating the var() soup. Keep these in sync with globals.css tokens.

export const TONE_TEXT: Record<SignalTone, string> = {
	ok: 'text-signal-ok',
	busy: 'text-signal-busy',
	fault: 'text-signal-fault',
	idle: 'text-signal-idle',
	info: 'text-signal-info',
};

export const TONE_SOFT: Record<SignalTone, string> = {
	ok: 'bg-signal-ok/10 text-signal-ok ring-signal-ok/20',
	busy: 'bg-signal-busy/10 text-signal-busy ring-signal-busy/20',
	fault: 'bg-signal-fault/10 text-signal-fault ring-signal-fault/20',
	idle: 'bg-signal-idle/10 text-signal-idle ring-signal-idle/20',
	info: 'bg-signal-info/10 text-signal-info ring-signal-info/20',
};
