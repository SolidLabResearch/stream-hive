import { CSPARQLWindow, QuadContainer } from "./s2r";
import { Quad } from "n3";

type Window = {
    open: number;
    close: number;
};

/**
 *
 * @param a
 * @param b
 */
function gcd(a: number, b: number): number {
    while (b !== 0) {
        const temp = b;
        b = a % b;
        a = temp;
    }
    return a;
}

/**
 *
 * @param values
 */
function findGCD(values: number[]): number {
    return values.reduce((acc, val) => gcd(acc, val));
}

type JoinGranularity = "width-only" | "width-and-slide";

/**
 *
 */
export class ChunkCreationOperator {
    private result_window_start: number;
    private granularity: JoinGranularity;

    /**
     *
     * @param t0
     * @param granularity
     */
    constructor(t0: number, granularity: JoinGranularity = "width-only") {
        this.result_window_start = t0;
        this.granularity = granularity;
    }

    /**
     *
     * @param windowLeft
     * @param windowRight
     */
    public temporalJoin(
        windowLeft: CSPARQLWindow,
        windowRight: CSPARQLWindow
    ): [Window, QuadContainer][] {
        const joinedResults: [Window, QuadContainer][] = [];

        const allWindowInstances = [
            ...windowLeft.active_windows,
            ...windowRight.active_windows
        ];
        const maxCloseTime = Math.max(...allWindowInstances.map(([win]) => win.close));

        const widths = allWindowInstances.map(([win]) => win.close - win.open);

        let gcdWidth: number;
        if (this.granularity === "width-and-slide") {
            gcdWidth = findGCD([
                ...widths,
                windowLeft.slide,
                windowRight.slide
            ]);
        } else {
            gcdWidth = findGCD(widths);
        }

        for (
            let t = this.result_window_start;
            t + gcdWidth <= maxCloseTime;
            t += gcdWidth
        ) {
            const windowStart = t;
            const windowEnd = t + gcdWidth;

            const eventsLeft = this.collectEventsInWindow(windowLeft, windowStart, windowEnd);
            const eventsRight = this.collectEventsInWindow(windowRight, windowStart, windowEnd);

            if (eventsLeft.length > 0 && eventsRight.length > 0) {
                const merged = this.mergeEvents(eventsLeft, eventsRight);
                if (merged.elements.size > 0) {
                    joinedResults.push([
                        { open: windowStart, close: windowEnd },
                        merged
                    ]);
                }
            }
        }

        return joinedResults;
    }

    /**
     *
     * @param window
     * @param start
     * @param end
     */
    private collectEventsInWindow(window: CSPARQLWindow, start: number, end: number): Quad[] {
        const collected: Quad[] = [];

        for (const [win, container] of window.active_windows) {
            const overlap = win.open < end && win.close > start;
            if (overlap) {
                const filtered = [...container.elements].filter((quad: Quad) => {
                    if (quad.object.termType !== "Literal") return false;
                    const timestamp = Number(quad.object.value);

                    // Normalize timestamp relative to result_window_start
                    const relativeTimestamp = timestamp - this.result_window_start;

                    return relativeTimestamp >= start && relativeTimestamp < end;
                });
                collected.push(...filtered);
            }
        }

        return collected;
    }


    /**
     *
     * @param a
     * @param b
     */
    private mergeEvents(a: Quad[], b: Quad[]): QuadContainer {
        a = this.removeGraphFromQuads(a);
        b = this.removeGraphFromQuads(b);
        const set = new Set<Quad>([...a, ...b]);
        const mergedContainer = new QuadContainer(set, Date.now());
        mergedContainer.elements = set;
        return mergedContainer;
    }

    /**
     *
     * @param quads
     */
    private removeGraphFromQuads(quads: Quad[]): Quad[] {
        return quads.map(quad => {
            // Create a new quad without the graph part (defaults to the default graph)
            return new Quad(quad.subject, quad.predicate, quad.object);
        });
    }
}
