/**
 * Serial Number Utilities — conversion between formats.
 *
 * The device serial number exists in 3 representations:
 *
 * ┌─────────────────────────┬──────────────────────────────────────────────────┐
 * │ Format                  │ Example                                          │
 * ├─────────────────────────┼──────────────────────────────────────────────────┤
 * │ Raw bytes (EEPROM)      │ [0x25, 0x5F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF] │
 * │ Hex string (hawkBit)    │ 255FFFFFFFFFFFF                                  │
 * │ Display (human-readable)│ 25.5F.FF.FF.FF.FF.FF.FF                          │
 * └─────────────────────────┴──────────────────────────────────────────────────┘
 *
 * How the serial arrives at hawkBit:
 *   1. EEPROM stores 8 raw bytes (written via //II command)
 *   2. Firmware converts each byte → 2-char uppercase hex: 0x25→"25", 0x5F→"5F", ...
 *   3. Result: 16-char uppercase hex string, no prefix/separators (e.g. "255FFFFFFFFFFFF")
 *   4. Device uses this as controllerId in DDI: GET /DEFAULT/controller/v1/255FFFFFFFFFFFF
 *
 * Fallback: if all 8 bytes are 0xFF (serial not programmed), firmware uses STM32 UID,
 * also 16 hex chars (e.g. "2100280018513531").
 *
 * Conventions:
 * - hawkBit controllerId = 16-char uppercase hex, no separators (e.g. 255FFFFFFFFFFFF)
 * - Display format = byte pairs separated by dots (e.g. 25.5F.FF.FF.FF.FF.FF.FF)
 * - API accepts any of: hex, dotted, or mixed case → normalizes internally
 *
 * The DB stores:
 * - serialNumber  → the hex format (same as hawkBit controllerId)
 * - serialDisplay → the dotted format (human-readable)
 */

/** Expected length for Ninbus device serial numbers (8 bytes = 16 hex chars). */
export const NINBUS_SERIAL_HEX_LENGTH = 16;

/**
 * Check if a string is pure hex (0-9, A-F, a-f).
 */
export function isHexString(s: string): boolean {
	return /^[0-9a-fA-F]+$/.test(s);
}

/**
 * Check if a string is dotted hex display format (e.g. "25.5F.FF.FF.FF.FF.FF.FF").
 * Allows mixed case with dots as separators.
 */
export function isDottedFormat(s: string): boolean {
	return /^[0-9a-fA-F]+(\.[0-9a-fA-F]+)+$/.test(s);
}

/**
 * Normalize any serial number input to uppercase hex without separators.
 *
 * Accepts:
 *   - "255FFFFFFFFFFFF"          → "255FFFFFFFFFFFF" (already hex)
 *   - "25.5F.FF.FF.FF.FF.FF.FF"  → "255FFFFFFFFFFFF" (dotted → hex)
 *   - "255fffFFF123456"           → "255FFFFFFF123456" (mixed case → upper)
 *   - "25:5F:FF:FF:FF:12:34:56"   → "255FFFFFFF123456" (colon-separated)
 *
 * Returns null if the input is not a recognizable hex serial format.
 */
export function normalizeToHex(input: string): string | null {
	if (!input || input.trim().length === 0) return null;

	const trimmed = input.trim();

	// Already pure hex
	if (isHexString(trimmed)) {
		return trimmed.toUpperCase();
	}

	// Dotted or colon-separated hex — remove separators and validate
	const cleaned = trimmed.replace(/[^0-9a-fA-F]/g, '');
	if (cleaned.length === 0) return null;
	if (!isHexString(cleaned)) return null;

	return cleaned.toUpperCase();
}

/**
 * Convert hex string to dotted display format.
 *
 * Groups hex chars in pairs separated by dots:
 * "AABBCCDD11223344" → "AA.BB.CC.DD.11.22.33.44"
 * "AABBCCDD"         → "AA.BB.CC.DD"
 */
export function hexToDisplay(hex: string): string {
	const upper = hex.toUpperCase();
	const groups: string[] = [];
	for (let i = 0; i < upper.length; i += 2) {
		groups.push(upper.slice(i, i + 2));
	}
	return groups.join('.');
}

/**
 * Convert dotted display format back to hex.
 *
 * "25.5F.FF.FF.FF.FF.FF.F6" → "255FFFFFFFFFFFF6"
 *
 * Also works for any separator (dots, colons, dashes).
 */
export function displayToHex(display: string): string {
	return display.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

/**
 * Full normalization: takes any input format, returns both hex and display.
 * Returns null if input is not a valid hex-based serial.
 */
export function normalizeSerial(input: string): { hex: string; display: string } | null {
	const hex = normalizeToHex(input);
	if (!hex) return null;
	return {
		hex,
		display: hexToDisplay(hex),
	};
}

/**
 * Validate that a hex serial number has the exact expected length for a Ninbus device.
 * Ninbus serials are always 8 bytes = 16 hex chars.
 * STM32 UID fallback is also 16 hex chars.
 */
export function isNinbusSerial(hex: string): boolean {
	return hex.length === NINBUS_SERIAL_HEX_LENGTH && isHexString(hex);
}

/**
 * Validate that a hex serial number has a reasonable length (lenient).
 * Accepts 4–32 hex chars for backward compatibility with non-Ninbus devices.
 */
export function isValidSerialLength(hex: string): boolean {
	return hex.length >= 4 && hex.length <= 32;
}
