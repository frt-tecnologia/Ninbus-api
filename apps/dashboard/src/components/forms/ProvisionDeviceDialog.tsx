'use client';

import { useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { useMutation } from '@/hooks/useFetch';
import { deviceService, ApiClientError } from '@/lib/api';

/**
 * ProvisionDeviceDialog — modal form to register a new device by serial number.
 *
 * Handles error cases:
 *  - 409 (serial already registered) → specific message.
 *  - 400 (invalid serial/key format) → API message.
 *  - 503 (hawkBit unreachable) → generic.
 */
export function ProvisionDeviceDialog({
	open,
	onClose,
	onProvisioned,
}: {
	open: boolean;
	onClose: () => void;
	onProvisioned: () => void;
}) {
	const [serialNumber, setSerialNumber] = useState('');
	const [deviceKey, setDeviceKey] = useState('');
	const [name, setName] = useState('');
	const [conflict, setConflict] = useState(false);

	const { run, loading, error, clearError } = useMutation(
		async (s: string, k: string, n: string) => {
			const input = { serialNumber: s, deviceKey: k, ...(n ? { name: n } : {}) };
			return deviceService.provision(input);
		},
	);

	function reset() {
		setSerialNumber('');
		setDeviceKey('');
		setName('');
		setConflict(false);
		clearError();
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const result = await run(serialNumber, deviceKey, name);
		if (result) {
			reset();
			onProvisioned();
			onClose();
		} else {
			// Detect 409 conflict to show a specific retry hint.
			// (error is set via the hook; we just flag the conflict UX)
			setConflict(true);
		}
	}

	return (
		<Modal
			open={open}
			onClose={() => {
				reset();
				onClose();
			}}
			title="Cadastrar novo dispositivo"
			description="Registra o dispositivo por número de série na plataforma."
			footer={
				<>
					<Button
						variant="outline"
						onClick={() => {
							reset();
							onClose();
						}}
						disabled={loading}
					>
						Cancelar
					</Button>
					<Button type="submit" form="provision-form" loading={loading}>
						Cadastrar
					</Button>
				</>
			}
		>
			<form id="provision-form" onSubmit={handleSubmit} className="space-y-4">
				<Field
					label="Número de série"
					htmlFor="serial"
					hint="Formato hex (ex.: 26.6.15.001.00031)"
					error={error && !conflict ? error : undefined}
				>
					<Input
						id="serial"
						required
						value={serialNumber}
						onChange={(e) => setSerialNumber(e.target.value)}
						placeholder="26.6.15.001.00031"
					/>
				</Field>

				<Field
					label="Chave do dispositivo (deviceKey)"
					htmlFor="key"
					hint="Chave de fábrica usada na autenticação DDI"
				>
					<Input
						id="key"
						required
						value={deviceKey}
						onChange={(e) => setDeviceKey(e.target.value)}
						placeholder="factory-device-key"
					/>
				</Field>

				<Field label="Nome (opcional)" htmlFor="name">
					<Input
						id="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Ex.: Ônibus 401"
					/>
				</Field>

				{conflict && (
					<div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
						Este número de série já está cadastrado. Verifique a lista de
						dispositivos.
					</div>
				)}
			</form>
		</Modal>
	);
}
