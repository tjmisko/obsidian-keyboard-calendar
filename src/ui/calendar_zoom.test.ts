import {
    DEFAULT_TIME_GRID_ZOOM_LEVEL,
    getTimeGridZoomDirection,
    getZoomAnchoredScrollTop,
    isTimeGridZoomView,
    refreshTimeGridLayout,
    TIME_GRID_ZOOM_LEVELS,
    TimeGridZoom,
} from "./calendar_zoom";
import { readFileSync } from "fs";
import { join } from "path";

const makeContainer = (): HTMLElement =>
    ({
        dataset: {},
        style: { setProperty: jest.fn() },
    } as unknown as HTMLElement);

describe("time-grid zoom", () => {
    it("out-ranks FullCalendar's later bundled fixed-height rule", () => {
        const stylesheet = readFileSync(
            join(__dirname, "overrides.css"),
            "utf8"
        );

        expect(stylesheet).toContain(".fc.fc .fc-timegrid-slot,");
        expect(stylesheet).toContain(".fc.fc .fc-timegrid-slot-label-frame {");
        expect(stylesheet).toContain(
            ".fc.fc .fc-timegrid-slot:empty::before {"
        );
    });

    it("maps the plus, equals, and minus keys without claiming other keys", () => {
        expect(getTimeGridZoomDirection("+")).toBe("in");
        expect(getTimeGridZoomDirection("=")).toBe("in");
        expect(getTimeGridZoomDirection("-")).toBe("out");
        expect(getTimeGridZoomDirection("_")).toBeNull();
    });

    it("only applies to the shared week and day time grids", () => {
        expect(isTimeGridZoomView("timeGridWeek")).toBe(true);
        expect(isTimeGridZoomView("timeGridDay")).toBe(true);
        expect(isTimeGridZoomView("dayGridMonth")).toBe(false);
    });

    it("shares one level across week and day and reduces label density", () => {
        const container = makeContainer();
        const zoom = new TimeGridZoom();

        zoom.applyTo(container);
        expect(zoom.level).toEqual(
            TIME_GRID_ZOOM_LEVELS[DEFAULT_TIME_GRID_ZOOM_LEVEL]
        );
        expect(container.dataset.ofcTimeLabelDensity).toBe("quarter-hour");

        expect(zoom.handleKey("-", "timeGridWeek", container)).toMatchObject({
            handled: true,
            changed: true,
        });
        expect(zoom.level.labelDensity).toBe("half-hour");

        expect(zoom.handleKey("-", "timeGridDay", container)).toMatchObject({
            handled: true,
            changed: true,
        });
        expect(zoom.level.labelDensity).toBe("hour");
        expect(container.style.setProperty).toHaveBeenLastCalledWith(
            "--ofc-timegrid-slot-height",
            "0.5rem"
        );
    });

    it("rebuilds FullCalendar slats before updating container sizing", () => {
        const calls: string[] = [];
        const calendar = {
            setOption: jest.fn(() => calls.push("slats")),
            updateSize: jest.fn(() => calls.push("size")),
        };

        refreshTimeGridLayout(
            calendar as Parameters<typeof refreshTimeGridLayout>[0],
            TIME_GRID_ZOOM_LEVELS[2]
        );

        expect(calendar.setOption).toHaveBeenCalledWith("slotLabelInterval", {
            minutes: 30,
        });
        expect(calendar.updateSize).toHaveBeenCalledTimes(1);
        expect(calls).toEqual(["slats", "size"]);
    });

    it("clamps at both ends while continuing to claim zoom keys", () => {
        const container = makeContainer();
        const zoom = new TimeGridZoom(0);

        expect(zoom.handleKey("-", "timeGridDay", container)).toEqual({
            handled: true,
            changed: false,
        });

        const maximum = new TimeGridZoom(TIME_GRID_ZOOM_LEVELS.length - 1);
        expect(maximum.handleKey("+", "timeGridWeek", container)).toEqual({
            handled: true,
            changed: false,
        });
    });

    it("does not change levels in the month view", () => {
        const container = makeContainer();
        const zoom = new TimeGridZoom();

        expect(zoom.handleKey("+", "dayGridMonth", container)).toEqual({
            handled: false,
            changed: false,
        });
        expect(zoom.level).toEqual(
            TIME_GRID_ZOOM_LEVELS[DEFAULT_TIME_GRID_ZOOM_LEVEL]
        );
    });

    it("should keep the anchored time fixed when the grid doubles in height", () => {
        // 10:00 sits at 400px of a 960px grid, 100px below the viewport top.
        expect(
            getZoomAnchoredScrollTop({
                scrollTop: 300,
                anchorOffset: 100,
                previousScrollHeight: 960,
                nextScrollHeight: 1920,
            })
        ).toBe(700);
    });

    it("should clamp to the top when zooming out near midnight", () => {
        expect(
            getZoomAnchoredScrollTop({
                scrollTop: 0,
                anchorOffset: 300,
                previousScrollHeight: 1920,
                nextScrollHeight: 960,
            })
        ).toBe(0);
    });

    it("should refuse to anchor an unmeasured grid", () => {
        expect(
            getZoomAnchoredScrollTop({
                scrollTop: 0,
                anchorOffset: 0,
                previousScrollHeight: 0,
                nextScrollHeight: 960,
            })
        ).toBeNull();
        expect(
            getZoomAnchoredScrollTop({
                scrollTop: NaN,
                anchorOffset: 0,
                previousScrollHeight: 960,
                nextScrollHeight: 960,
            })
        ).toBeNull();
    });

    it("should jump to a restored level and restyle the container", () => {
        const container = makeContainer();
        const zoom = new TimeGridZoom();

        expect(zoom.setIndex(5, container)).toBe(true);
        expect(zoom.index).toBe(5);
        expect(container.style.setProperty).toHaveBeenLastCalledWith(
            "--ofc-timegrid-slot-height",
            TIME_GRID_ZOOM_LEVELS[5].slotHeight
        );
    });

    it("should clamp a restored level from a larger scale to the top level", () => {
        const zoom = new TimeGridZoom();

        expect(zoom.setIndex(99, null)).toBe(true);
        expect(zoom.index).toBe(TIME_GRID_ZOOM_LEVELS.length - 1);
    });

    it("should report no change for the current level or a non-finite level", () => {
        const container = makeContainer();
        const zoom = new TimeGridZoom(2);

        expect(zoom.setIndex(2, container)).toBe(false);
        expect(zoom.setIndex(NaN, container)).toBe(false);
        expect(zoom.index).toBe(2);
        expect(container.style.setProperty).not.toHaveBeenCalled();
    });
});
