/**
 * Simple debounce utility — returns a debounced version of the given function.
 */
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    ms: number
): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return (...args: Parameters<T>) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}
