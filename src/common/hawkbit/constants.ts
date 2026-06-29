/**
 * Ninbus Artifact Types — Constants and metadata for hawkBit Software Module Types.
 *
 * These types map to hawkBit Software Module Type keys.
 * Each type determines what action the embedded device takes during OTA.
 *
 * - firmware-ninbus       → NAND firmware → reboot (bootloader aplica)
 * - firmware-controller   → CAN → LightDot
 * - configuration-nfx     → NAND NFX → CAN → LightDot
 */

export const NINBUS_ARTIFACT_TYPES = {
	NINBUS_FIRMWARE: 'firmware-ninbus',
	CONTROLLER_FIRMWARE: 'firmware-controller',
	NFX_CONFIGURATION: 'configuration-nfx',
} as const;

export type NinbusArtifactType = (typeof NINBUS_ARTIFACT_TYPES)[keyof typeof NINBUS_ARTIFACT_TYPES];

export const NINBUS_ARTIFACT_TYPE_META: Record<
	NinbusArtifactType,
	{
		label: string;
		description: string;
		target: string;
		requiresReboot: boolean;
		riskLevel: 'low' | 'medium' | 'high';
	}
> = {
	[NINBUS_ARTIFACT_TYPES.NINBUS_FIRMWARE]: {
		label: 'Firmware Ninbus',
		description: 'Firmware principal do STM32F407 (Ninbus WiFi v3)',
		target: 'NAND Flash → Bootloader → Flash interna',
		requiresReboot: true,
		riskLevel: 'high',
	},
	[NINBUS_ARTIFACT_TYPES.CONTROLLER_FIRMWARE]: {
		label: 'Firmware Controlador',
		description: 'Firmware do controlador LightDot via barramento CAN',
		target: 'CAN Bus → LightDot',
		requiresReboot: false,
		riskLevel: 'medium',
	},
	[NINBUS_ARTIFACT_TYPES.NFX_CONFIGURATION]: {
		label: 'Configuração NFX',
		description: 'Configuração NFX/FRZ dos painéis via CAN',
		target: 'NAND NFX → CAN → LightDot',
		requiresReboot: false,
		riskLevel: 'low',
	},
};

export const NINBUS_DEVICE_TYPE = 'ninbus-wifi-v3';

export function isNinbusArtifactType(type: string): type is NinbusArtifactType {
	return Object.values(NINBUS_ARTIFACT_TYPES).includes(type as NinbusArtifactType);
}

/**
 * Resolve the Ninbus artifact type from a hawkBit Software Module.
 * In hawkBit, the type is stored in the `type` field of a Software Module.
 */
export function resolveArtifactType(softwareModule: {
	type: string;
}): NinbusArtifactType | null {
	if (isNinbusArtifactType(softwareModule.type)) return softwareModule.type;
	return null;
}
