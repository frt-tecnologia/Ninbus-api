/**
 * Release upload pipeline — canonical tar ingestion (factory .tar verbatim or
 * server-side v2 signing from a raw .bin). Contract: SKILL.md § Firmware OTA.
 */
import { randomUUID } from 'node:crypto';
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { firmwareReleases } from '@common/db/schema';
import {
	NINBUS_ARTIFACT_TYPES,
	getOrCreateSoftwareModuleType,
	hawkbitSoftwareModules,
} from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { validateFileSize } from '@modules/artifacts/service';
import { packageArtifact } from '@modules/artifacts/tar-packager';
import { and, eq } from 'drizzle-orm';
import { type FIRMWARE_TYPES, catalogCounterFloor } from './catalog';
import { FirmwareValidationError } from './errors';
import { OtaSignerError, buildNinbusTar, packVersionString } from './ota-signer';
import {
	type CanonicalArtifactType,
	InvalidPackageError,
	validateCanonicalTar,
} from './tar-validator';

export interface FirmwareUploadInput {
	name: string;
	version: string;
	artifactType: (typeof FIRMWARE_TYPES)[number];
	description?: string;
}

function toFirmwareError(e: unknown): FirmwareValidationError {
	if (e instanceof OtaSignerError || e instanceof InvalidPackageError) {
		return new FirmwareValidationError(
			e.message,
			e instanceof OtaSignerError ? e.code : 'INVALID_PACKAGE',
		);
	}
	return e as FirmwareValidationError;
}

export async function uploadFirmwareRelease(
	userId: string,
	file: File,
	input: FirmwareUploadInput,
) {
	const isTar = file.name.toLowerCase().endsWith('.tar');
	const isNinbus = input.artifactType === 'firmware-ninbus';
	const floor = isNinbus ? await catalogCounterFloor() : 0;
	const signCounter = isNinbus && !isTar ? floor + 1 : null;
	validateFileSize(file.size);

	let fileBuffer: Buffer = Buffer.from(await file.arrayBuffer());
	let tarInfo: Awaited<ReturnType<typeof validateCanonicalTar>> | null = null;
	if (signCounter !== null) {
		appLogger.info(
			'[FIRMWARE] Server-side signing: %s (%d KB) counter=%d version=%s → tar v2',
			file.name,
			Math.round(fileBuffer.length / 1024),
			signCounter,
			input.version,
		);
		try {
			fileBuffer = await buildNinbusTar(fileBuffer, signCounter, {
				version: packVersionString(input.version),
			});
			tarInfo = await validateCanonicalTar(fileBuffer, 'firmware-ninbus');
		} catch (e) {
			throw toFirmwareError(e);
		}
	} else if (isTar) {
		try {
			tarInfo = await validateCanonicalTar(fileBuffer, input.artifactType as CanonicalArtifactType);
		} catch (e) {
			throw toFirmwareError(e);
		}
		if (isNinbus) assertFactoryTarInvariants(tarInfo, input.version, floor);
	}

	if (!hawkbitConfig.enabled) {
		throw new FirmwareValidationError(
			'Firmware operations require hawkBit to be enabled',
			'HAWKBIT_NOT_ENABLED',
		);
	}

	const [dupe] = await db
		.select({ id: firmwareReleases.id })
		.from(firmwareReleases)
		.where(
			and(
				eq(firmwareReleases.artifactType, input.artifactType),
				eq(firmwareReleases.version, input.version),
			),
		);
	if (dupe) {
		throw new FirmwareValidationError(
			`Version ${input.version} of ${input.artifactType} already exists (release ${dupe.id}). Version tags are unique per firmware type.`,
			'DUPLICATE_VERSION',
		);
	}

	appLogger.info(
		'[FIRMWARE] Uploading release: %s (%d KB) type=%s version=%s',
		file.name,
		Math.round(file.size / 1024),
		input.artifactType,
		input.version,
	);

	let tarBlob: Blob;
	let tarFilename: string;
	let tarSize: number;
	let payloadBytes: number;
	if (isTar || signCounter !== null) {
		tarBlob = new Blob([fileBuffer], { type: 'application/x-tar' });
		tarFilename = signCounter !== null ? file.name.replace(/\.[^.]+$/, '') + '.tar' : file.name;
		tarSize = fileBuffer.length;
		payloadBytes = tarInfo!.imageSize;
	} else {
		const packaged = await packageArtifact(file, input.artifactType);
		tarBlob = packaged.blob;
		tarFilename = packaged.filename;
		tarSize = packaged.size;
		payloadBytes = file.size;
	}

	const smType = await getOrCreateSoftwareModuleType(input.artifactType);
	const sm = await hawkbitSoftwareModules.create({
		name: `sm-${randomUUID()}`,
		version: input.version,
		type: smType.typeKey,
		description: [
			input.description ?? `Ninbus firmware release: ${input.artifactType}`,
			`releaseName: ${input.name}`,
			`originalFile: ${file.name}`,
			`payloadBytes: ${payloadBytes}`,
		].join(' | '),
	});
	appLogger.info('[FIRMWARE] Created SM %d (release: %s)', sm.id, input.name);

	const artifact = await hawkbitSoftwareModules.uploadArtifact(
		sm.id,
		new File([tarBlob], tarFilename, { type: 'application/x-tar' }),
	);

	const [release] = await db
		.insert(firmwareReleases)
		.values({
			hawkbitSmId: sm.id,
			name: input.name,
			version: input.version,
			artifactType: input.artifactType,
			description: input.description ?? null,
			originalFilename: file.name,
			payloadSize: payloadBytes,
			packageSize: tarSize,
			counter: signCounter ?? tarInfo?.counter ?? null,
			manifestVersion: tarInfo?.versionPacked ?? null,
			manifestFlags:
				tarInfo && tarInfo.allowDowngrade !== null ? (tarInfo.allowDowngrade ? 0x1 : 0x0) : null,
			createdBy: userId,
		})
		.returning();
	if (!release) {
		throw new FirmwareValidationError(
			'Failed to record the firmware release (database error)',
			'NOT_FOUND',
		);
	}

	appLogger.info(
		'[FIRMWARE] Release %s created (draft): %s v%s (SM %d, artifact #%s)',
		release.id,
		input.name,
		input.version,
		sm.id,
		artifact.id,
	);
	return {
		releaseId: release.id,
		smId: sm.id,
		artifactId: artifact.id,
		name: release.name,
		version: release.version,
		type: release.artifactType,
		size: tarSize,
		payloadSize: payloadBytes,
	};
}

/** Factory-.tar invariants: signed version is the source (typed = conferência) + strictly-greater counter. */
function assertFactoryTarInvariants(
	tarInfo: Awaited<ReturnType<typeof validateCanonicalTar>>,
	typedVersion: string,
	floor: number,
) {
	if (tarInfo.manifestFormat === 2 && tarInfo.versionText !== typedVersion) {
		throw new FirmwareValidationError(
			`Versão digitada (${typedVersion}) difere da versão ASSINADA no manifesto v2 (${tarInfo.versionText}). O manifesto é a fonte — re-uploade com a versão correta ou re-assine o .tar (ota_sign.py --version ${tarInfo.versionText}).`,
			'INVALID_VERSION',
		);
	}
	if ((tarInfo.counter ?? 0) <= floor) {
		throw new FirmwareValidationError(
			`Counter do manifesto (${tarInfo.counter}) deve ser ESTRITAMENTE maior que o máximo do catálogo (${floor}) — o piso anti-replay dos devices não regride. Re-assine com ota_sign.py usando counter ≥ ${floor + 1}.`,
			'INVALID_COUNTER',
		);
	}
}

export { NINBUS_ARTIFACT_TYPES };
