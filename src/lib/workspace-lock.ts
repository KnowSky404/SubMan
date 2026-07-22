const fallbackLockTails = new Map<string, Promise<void>>();

type LockManagerLike = {
	request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

function getLockManager(): LockManagerLike | null {
	if (typeof navigator === "undefined") return null;
	const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
	return locks && typeof locks.request === "function" ? locks : null;
}

async function withFallbackLock<T>(
	name: string,
	callback: () => Promise<T>,
): Promise<T> {
	const previous = fallbackLockTails.get(name) ?? Promise.resolve();
	let release = () => {};
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	fallbackLockTails.set(name, current);

	await previous;
	try {
		return await callback();
	} finally {
		release();
		if (fallbackLockTails.get(name) === current) {
			fallbackLockTails.delete(name);
		}
	}
}

export function withWorkspaceLock<T>(
	name: string,
	callback: () => Promise<T>,
): Promise<T> {
	const locks = getLockManager();
	return locks
		? locks.request(name, callback)
		: withFallbackLock(name, callback);
}
