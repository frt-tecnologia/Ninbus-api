/**
 * Serial Number Utilities — BCD packing between display format and HEX controller ID.
 *
 * ┌──────────────────────────┬───────────────────────────────────────────────────┐
 * │ Format                   │ Example                                           │
 * ├──────────────────────────┼───────────────────────────────────────────────────┤
 * │ Display (user-visible)   │ 26.6.15.001.00031                                 │
 * │ HEX (hawkBit controller) │ 1A61500100031FFF                                  │
 * │ Raw bytes (EEPROM)       │ [0x1A, 0x61, 0x50, 0x01, 0x00, 0x03, 0x1F, 0xFF] │
 * └──────────────────────────┴───────────────────────────────────────────────────┘
 *
 * Display fields (AA.M.PP.SSS.NNNNN):
 *   AA    = Year (0-99, 2 digits)
 *   M     = Month hex (0-9=Jan-Sep, A=Oct, B=Nov, C=Dec) — always 1 char
 *   PP    = Product code (0-99, 2 digits with leading zeros)
 *   SSS   = Series/lot (0-999, 3 digits with leading zeros)
 *   NNNNN = Sequential (0-99999, 5 digits with leading zeros)
 *
 * BCD packing algorithm (each display digit = 1 nibble, except AA = binary):
 *   1. AA → binary byte (26 → 0x1A)
 *   2. M + PP + SSS + NNNNN → nibble stream (each char = 1 nibble)
 *   3. Append reserved FFF (3 nibbles)
 *   4. Total: 1 byte (AA) + 7 bytes (14 nibbles) = 8 bytes = 16 hex chars
 *
 * Fallback: unprogrammed EEPROM (all FF) → firmware uses STM32 UID (16 hex chars).
 *
 * DB stores: serialNumber = HEX (controllerId), serialDisplay = display with dots.
 */

/** Expected length for Ninbus device serial numbers (8 bytes = 16 hex chars). */
export const NINBUS_SERIAL_HEX_LENGTH = 16;

/** Check if a string is pure hex (0-9, A-F, a-f). */
export function isHexString(s: string): boolean {
	return /^[0-9a-fA-F]+$/.test(s);
}

/** Check if a string is dotted hex (e.g. "1A.61.50.01"). Legacy format support. */
export function isDottedFormat(s: string): boolean {
	return /^[0-9a-fA-F]+(\.[0-9a-fA-F]+)+$/.test(s);
}

/**
 * Check if a string is serial display format (e.g. "26.6.15.001.00031" or "26.B.15.001.01212").
 * M accepts hex chars 0-9, A-C (case-insensitive). Other fields are decimal digits.
 */
export function isDecimalSerial(s: string): boolean {
	return /^\d{1,2}\.[0-9A-Ca-c]\.\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(s);
}

// ---------------------------------------------------------------------------
// BCD packing: display ↔ HEX controller ID
// ---------------------------------------------------------------------------

/**
 * Convert serial display to HEX controller ID (16 uppercase chars) using BCD packing.
 *
 * Algorithm:
 *   1. AA → binary (26 → 0x1A)
 *   2. M + PP + SSS + NNNNN → each char becomes a nibble
 *   3. Append FFF reserved → pad to 14 nibbles
 *   4. Pack nibbles into bytes → prepend AA byte
 *
 * @example
 *   decimalSerialToHex("26.6.15.001.00031")  // "1A61500100031FFF"
 *   decimalSerialToHex("26.B.15.001.01212")  // "1AB1500101212FFF"
 *   decimalSerialToHex("26.C.15.001.31232")  // "1AC1500131232FFF"
 *
 * @returns 16-char uppercase HEX, or null if invalid
 */
export function decimalSerialToHex(serialDecimal: string): string | null {
	const parts = serialDecimal.split('.');
	if (parts.length !== 5) return null;

	const AA = parseInt(parts[0]!, 10);
	if (isNaN(AA) || AA < 0 || AA > 99) return null;

	// M: 1 hex char (0-9, A-C)
	const mChar = parts[1]!.toUpperCase();
	if (!/^[0-9A-C]$/.test(mChar)) return null;

	// PP: decimal, padded to 2 digits
	const ppVal = parseInt(parts[2]!, 10);
	if (isNaN(ppVal) || ppVal < 0 || ppVal > 99) return null;
	const ppStr = ppVal.toString().padStart(2, '0');
	// Each char must be a valid nibble (0-9 for PP since max is 99)
	if (!/^\d{2}$/.test(ppStr)) return null;

	// SSS: decimal, padded to 3 digits
	const sssVal = parseInt(parts[3]!, 10);
	if (isNaN(sssVal) || sssVal < 0 || sssVal > 999) return null;
	const sssStr = sssVal.toString().padStart(3, '0');
	if (!/^\d{3}$/.test(sssStr)) return null;

	// NNNNN: decimal, padded to 5 digits
	const nnnnnVal = parseInt(parts[4]!, 10);
	if (isNaN(nnnnnVal) || nnnnnVal < 0 || nnnnnVal > 99999) return null;
	const nnnnnStr = nnnnnVal.toString().padStart(5, '0');
	if (!/^\d{5}$/.test(nnnnnStr)) return null;

	// Build nibble stream: M(1) + PP(2) + SSS(3) + NNNNN(5) + FFF = 14 nibbles
	const nibbleStream = mChar + ppStr + sssStr + nnnnnStr + 'FFF';

	// Pack: AA as binary byte, then nibble pairs as bytes
	const bytes = [AA];
	for (let i = 0; i < nibbleStream.length; i += 2) {
		const high = parseInt(nibbleStream[i]!, 16);
		const low = (i + 1 < nibbleStream.length) ? parseInt(nibbleStream[i + 1]!, 16) : 0;
		bytes.push((high << 4) | low);
	}

	return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

/**
 * Convert HEX controller ID (16 chars) back to serial display format.
 * Inverse BCD unpacking — extracts AA, M, PP, SSS, NNNNN from nibbles.
 * Returns null for non-serial HEX (e.g. STM32 UID without FFF reserved bytes).
 *
 * @example
 *   hexToDecimalSerial("1A61500100031FFF") // "26.6.15.001.00031"
 *   hexToDecimalSerial("1AB1500101212FFF") // "26.B.15.001.01212"
 */
export function hexToDecimalSerial(hexString: string): string | null {
	if (!isHexString(hexString) || hexString.length !== 16) return null;

	// Extract bytes
	const bytes: number[] = [];
	for (let i = 0; i < 16; i += 2) {
		bytes.push(parseInt(hexString.substring(i, i + 2), 16));
	}

	// Reserved nibbles must be FFF — serial numbers always have these.
	if ((bytes[6]! & 0x0F) !== 0x0F || bytes[7] !== 0xFF) return null;

	// AA: first byte as decimal
	const AA = bytes[0]!;
	if (AA > 99) return null;

	// Extract nibble stream from bytes 1-7 (14 nibbles)
	let nibbles = '';
	for (let i = 1; i < bytes.length; i++) {
		nibbles += ((bytes[i]! >> 4) & 0x0F).toString(16).toUpperCase();
		nibbles += (bytes[i]! & 0x0F).toString(16).toUpperCase();
	}

	// Strip last 3 nibbles (FFF reserved) → 11 data nibbles
	const data = nibbles.slice(0, -3); // "61500100031"

	// M: 1 hex char, PP: 2 digits, SSS: 3 digits, NNNNN: 5 digits
	const mChar = data[0]!;
	if (!/^[0-9A-C]$/.test(mChar)) return null;

	const ppVal = parseInt(data.substring(1, 3), 10);
	if (isNaN(ppVal) || ppVal > 99) return null;

	const sssVal = parseInt(data.substring(3, 6), 10);
	if (isNaN(sssVal) || sssVal > 999) return null;

	const nnnnnVal = parseInt(data.substring(6, 11), 10);
	if (isNaN(nnnnnVal) || nnnnnVal > 99999) return null;

	const pad = (n: number, d: number) => String(n).padStart(d, '0');
	return `${pad(AA, 2)}.${mChar}.${pad(ppVal, 2)}.${pad(sssVal, 3)}.${pad(nnnnnVal, 5)}`;
}

// ---------------------------------------------------------------------------
// Internal hex normalization
// ---------------------------------------------------------------------------

/** Normalize hex-based input to uppercase hex without separators. Returns null if invalid. */
function normalizeToHex(input: string): string | null {
	if (!input || input.trim().length === 0) return null;
	const trimmed = input.trim();
	if (isHexString(trimmed)) return trimmed.toUpperCase();
	const cleaned = trimmed.replace(/[^0-9a-fA-F]/g, '');
	if (cleaned.length === 0 || !isHexString(cleaned)) return null;
	return cleaned.toUpperCase();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert HEX controller ID to human-readable display.
 * Serial HEX → display ("26.6.15.001.00031"). Non-serial HEX → dotted-hex fallback.
 */
export function hexToDisplay(hex: string): string {
	const decimal = hexToDecimalSerial(hex);
	if (decimal) return decimal;
	// Fallback for non-serial hex (STM32 UID, etc.)
	const upper = hex.toUpperCase();
	const groups: string[] = [];
	for (let i = 0; i < upper.length; i += 2) groups.push(upper.slice(i, i + 2));
	return groups.join('.');
}

/**
 * Convert display format to HEX. Display ("26.6.15.001.00031") or legacy dotted-hex.
 */
export function displayToHex(display: string): string {
	if (isDecimalSerial(display)) {
		const hex = decimalSerialToHex(display);
		if (hex) return hex;
	}
	return display.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

/**
 * Full normalization: any input format → { hex, display }.
 * Accepts display (26.6.15.001.00031), HEX (1A61500100031FFF), or dotted-hex.
 * Returns null if input is not recognizable.
 */
export function normalizeSerial(input: string): { hex: string; display: string } | null {
	if (!input || input.trim().length === 0) return null;
	const trimmed = input.trim();

	// Display serial format (user input: "26.6.15.001.00031")
	if (isDecimalSerial(trimmed)) {
		const hex = decimalSerialToHex(trimmed);
		if (hex) return { hex, display: trimmed };
		return null;
	}

	// HEX-based input
	const hex = normalizeToHex(trimmed);
	if (!hex) return null;
	return { hex, display: hexToDisplay(hex) };
}

/** Validate HEX serial has exact Ninbus length (8 bytes = 16 hex chars). */
export function isNinbusSerial(hex: string): boolean {
	return hex.length === NINBUS_SERIAL_HEX_LENGTH && isHexString(hex);
}

/** Lenient validation — accepts 4–32 hex chars for non-Ninbus devices. */
export function isValidSerialLength(hex: string): boolean {
	return hex.length >= 4 && hex.length <= 32;
}
