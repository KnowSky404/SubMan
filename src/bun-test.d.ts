declare module "bun:test" {
	type TestCallback = () => void | Promise<void>;

	export function describe(name: string, callback: TestCallback): void;
	export function it(name: string, callback: TestCallback): void;
	export function test(name: string, callback: TestCallback): void;

	export function expect(actual: unknown): {
		toBe(expected: unknown): void;
		toBeGreaterThan(expected: number): void;
		toBeNull(): void;
		toContain(expected: string): void;
		toEqual(expected: unknown): void;
		toHaveLength(expected: number): void;
		toThrow(expected?: string | RegExp): void;
		not: {
			toContain(expected: string): void;
		};
	};
}
