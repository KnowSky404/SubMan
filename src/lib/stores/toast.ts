import { writable } from 'svelte/store';

export type ToastType = 'success' | 'info' | 'error';

export interface Toast {
	message: string;
	type: ToastType;
	id: number;
}

export const toastStore = writable<Toast[]>([]);

let nextId = 0;

export function showToast(message: string, type: ToastType = 'success', duration = 3000) {
	const id = nextId++;
	toastStore.update((all) => [...all, { message, type, id }]);
	
	if (duration > 0) {
		setTimeout(() => {
			dismissToast(id);
		}, duration);
	}
	return id;
}

export function dismissToast(id: number) {
	toastStore.update((all) => all.filter((t) => t.id !== id));
}
