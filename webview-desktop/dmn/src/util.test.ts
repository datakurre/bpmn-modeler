import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debounce } from "./util";

describe("debounce", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("should call the function after the delay", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced();
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledOnce();
    });

    it("should reset the timer on subsequent calls", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced();
        vi.advanceTimersByTime(50);
        debounced();
        vi.advanceTimersByTime(50);

        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(50);
        expect(fn).toHaveBeenCalledOnce();
    });

    it("should pass arguments to the debounced function", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced("a", "b");
        vi.advanceTimersByTime(100);

        expect(fn).toHaveBeenCalledWith("a", "b");
    });

    it("should use the last call's arguments", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced("first");
        debounced("second");
        debounced("third");
        vi.advanceTimersByTime(100);

        expect(fn).toHaveBeenCalledOnce();
        expect(fn).toHaveBeenCalledWith("third");
    });

    it("should allow multiple independent invocations after delay", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced();
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);

        debounced();
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
