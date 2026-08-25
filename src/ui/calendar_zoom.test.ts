import {
    DEFAULT_TIME_GRID_ZOOM_LEVEL,
    getTimeGridZoomDirection,
    isTimeGridZoomView,
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
        expect(isTimeGridZoomView("listWeek")).toBe(false);
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

    it("does not change levels in month or list views", () => {
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
});
