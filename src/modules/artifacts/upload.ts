/**
 * Artifact upload — package firmware file, create SM in hawkBit, register locally.
 * Extracted from service.ts to keep file under 250 lines.
 */
import { db } from '@common/db';
import { artifacts } from '@common/db/schema';
import {
	NINBUS_ARTIFACT_TYPE_META,
	type NinbusArtifactType,
	getOrCreateSoftwareModuleType,
	hawkbitSoftwareModules,
} from '@common/hawkbit/client';
import { hawkbitConfig } from '@common/config/hawkbit';
import { appLogger } from '@common/logger';
import { randomUUID } from 'crypto';
import { packageArtifact } from './tar-packager';
import { validateFileExtension, validateFileSize, type ArtifactUploadResult } from './service';

/** Minimum sane size for a firmware-ninbus .fir: must hold the bootloader CRC16
 *  at offset 1047, so anything smaller cannot be a valid post-CalcCRC image. */
const FIRMWARE_NINBUS_MIN_BYTES = 1048;

/** Upload raw firmware file to hawkBit + register in local DB. */
export async function uploadArtifact(
	companyId: string,
	userId: string,
	file: File,
	artifactName: string,
	artifactType: NinbusArtifactType,
	version?: string,
	description?: string,
): Promise<ArtifactUploadResult> {
	validateFileExtension(file.name);
	validateFileSize(file.size);
	if (!hawkbitConfig.enabled) {
		throw new Error('Artifact operations require hawkBit to be enabled');
	}

	appLogger.info('[ARTIFACT] Uploading: %s (%d KB) type=%s', file.name, Math.round(file.size / 1024), artifactType);

	// firmware-ninbus safety net: the bootloader reads CRC16 at offset 1047. The
	// backend serves the bytes VERBATIM (no CRC injection), so the uploaded .fir
	// must already be the post-CalcCRC image. Flag (not block) suspicious inputs.
	if (artifactType === 'firmware-ninbus' && file.size < FIRMWARE_NINBUS_MIN_BYTES) {
		appLogger.warn(
			'[ARTIFACT] firmware-ninbus payload is only %d bytes — a valid .fir must be >= 1048 bytes to carry the bootloader CRC16 at offset 1047. Did you upload the post-CalcCRC wifi3.fir?',
			file.size,
		);
	}

	const packaged = await packageArtifact(file, artifactType);

	const smType = await getOrCreateSoftwareModuleType(artifactType);
	const smUuid = randomUUID();
	const smInternalName = `sm-${smUuid}`;
	const smVersion = version ?? '1.0';

	const smDescription = [
		description ?? `Ninbus OTA: ${artifactType}`,
		`artifactName: ${artifactName}`,
		`originalFile: ${file.name}`,
		`payloadBytes: ${file.size}`,
	].join(' | ');

	const sm = await hawkbitSoftwareModules.create({
		name: smInternalName, version: smVersion, type: smType.typeKey, description: smDescription,
	});

	appLogger.info('[ARTIFACT] Created SM %d (display: %s)', sm.id, artifactName);

	const tarFile = new File([packaged.blob], packaged.filename, { type: 'application/x-tar' });
	const artifact = await hawkbitSoftwareModules.uploadArtifact(sm.id, tarFile);

	appLogger.info(
		`[ARTIFACT] Upload complete: artifact #${artifact.id} size=${artifact.size ?? 'undefined'} filename=${artifact.providedFilename} ` +
		`(expected ~${packaged.size} bytes)`,
	);

	await db.insert(artifacts).values({
		companyId,
		hawkbitSmId: sm.id,
		name: artifactName,
		artifactType,
		version: sm.version,
		description: description ?? `Ninbus OTA: ${artifactType}`,
		originalFilename: file.name,
		payloadSize: file.size,
		packageSize: packaged.size,
		createdBy: userId,
	});

	appLogger.info('[ARTIFACT] Registered SM %d for company %s', sm.id, companyId);

	return {
		smId: sm.id, artifactId: artifact.id, name: artifactName,
		version: sm.version, type: sm.type, size: packaged.size, payloadSize: file.size,
		ninbusType: artifactType, ninbusMeta: NINBUS_ARTIFACT_TYPE_META[artifactType],
	};
}
