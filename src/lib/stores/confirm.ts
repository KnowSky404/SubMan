import { writable } from "svelte/store";

export type ConfirmDialogOptions = {
	title?: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	danger?: boolean;
};

export type ConfirmDialogState = {
	open: boolean;
	title: string;
	message: string;
	confirmText: string;
	cancelText: string;
	danger: boolean;
};

const defaultState: ConfirmDialogState = {
	open: false,
	title: "",
	message: "",
	confirmText: "",
	cancelText: "",
	danger: false
};

export const confirmDialog = writable<ConfirmDialogState>(defaultState);

let pendingResolver: ((value: boolean) => void) | null = null;

export function requestConfirm(options: ConfirmDialogOptions): Promise<boolean> {
	if (pendingResolver) {
		pendingResolver(false);
		pendingResolver = null;
	}

	confirmDialog.set({
		open: true,
		title: options.title ?? "",
		message: options.message,
		confirmText: options.confirmText ?? "",
		cancelText: options.cancelText ?? "",
		danger: options.danger ?? false
	});

	return new Promise((resolve) => {
		pendingResolver = resolve;
	});
}

export function resolveConfirm(value: boolean): void {
	const resolver = pendingResolver;
	pendingResolver = null;
	confirmDialog.set(defaultState);
	if (resolver) {
		resolver(value);
	}
}
