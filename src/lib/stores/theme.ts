import { derived, readable, writable } from "svelte/store";
import { browser } from "$app/environment";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "subman:theme-mode:v1";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

function normalizeThemeMode(value: string | null | undefined): ThemeMode {
	return value === "light" || value === "dark" ? value : "system";
}

function getStoredThemeMode(): ThemeMode {
	if (!browser) {
		return "system";
	}
	return normalizeThemeMode(localStorage.getItem(STORAGE_KEY));
}

export const themeMode = writable<ThemeMode>(getStoredThemeMode());

const systemTheme = readable<ResolvedTheme>("light", (set) => {
	if (!browser) {
		return undefined;
	}

	const mediaQuery = window.matchMedia(MEDIA_QUERY);
	const update = () => set(mediaQuery.matches ? "dark" : "light");

	update();
	mediaQuery.addEventListener("change", update);

	return () => mediaQuery.removeEventListener("change", update);
});

export const resolvedTheme = derived(
	[themeMode, systemTheme],
	([$themeMode, $systemTheme]): ResolvedTheme =>
		$themeMode === "system" ? $systemTheme : $themeMode,
);

let themeSyncStarted = false;

function applyTheme(mode: ThemeMode, resolved: ResolvedTheme): void {
	if (!browser) {
		return;
	}

	const root = document.documentElement;
	root.style.colorScheme = resolved;
	root.dataset.themeMode = mode;

	if (mode === "system") {
		delete root.dataset.theme;
		return;
	}

	root.dataset.theme = mode;
}

export function startThemeSync(): () => void {
	if (!browser || themeSyncStarted) {
		return () => {};
	}

	themeSyncStarted = true;

	const modeUnsubscribe = themeMode.subscribe((value) => {
		localStorage.setItem(STORAGE_KEY, value);
	});

	const resolvedUnsubscribe = derived(
		[themeMode, resolvedTheme],
		([$mode, $resolved]) => ({
			mode: $mode,
			resolved: $resolved,
		}),
	).subscribe(({ mode, resolved }) => {
		applyTheme(mode, resolved);
	});

	return () => {
		modeUnsubscribe();
		resolvedUnsubscribe();
		themeSyncStarted = false;
	};
}
