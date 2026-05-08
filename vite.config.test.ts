import { describe, expect, it } from "bun:test";
import { DEV_PORT_MAX, DEV_PORT_MIN, pickRandomDevPort } from "./vite.config";

describe("pickRandomDevPort", () => {
	it("uses the lower bound when random returns zero", () => {
		expect(pickRandomDevPort(() => 0)).toBe(DEV_PORT_MIN);
	});

	it("keeps ports inside the inclusive development range", () => {
		expect(pickRandomDevPort(() => 0.999999)).toBe(DEV_PORT_MAX);
	});

	it("supports custom inclusive ranges", () => {
		expect(pickRandomDevPort(() => 0, 9000, 9001)).toBe(9000);
		expect(pickRandomDevPort(() => 0.999999, 9000, 9001)).toBe(9001);
	});
});
