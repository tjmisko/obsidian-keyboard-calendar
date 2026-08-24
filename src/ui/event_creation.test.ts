import { handleCalendarSelection } from "./event_creation";

const start = new Date(2026, 7, 22, 9, 0);
const end = new Date(2026, 7, 22, 10, 30);

describe("calendar selection routing", () => {
    it("creates a timed full-note event directly from a timed grid selection", async () => {
        const openDay = jest.fn();
        const createTimedNote = jest.fn(async () => undefined);

        await handleCalendarSelection({
            start,
            end,
            viewType: "timeGridWeek",
            openDay,
            createTimedNote,
        });

        expect(openDay).not.toHaveBeenCalled();
        expect(createTimedNote).toHaveBeenCalledWith(
            {
                type: "single",
                date: "2026-08-22",
                startTime: "09:00",
                endTime: "10:30",
            },
            { focusTitle: false, focusEventOnReturn: true }
        );
    });

    it("requests title focus for an insert-mode selection", async () => {
        const createTimedNote = jest.fn(async () => undefined);

        await handleCalendarSelection({
            start,
            end,
            viewType: "timeGridWeek",
            focusTitle: true,
            openDay: jest.fn(),
            createTimedNote,
        });

        expect(createTimedNote).toHaveBeenCalledWith(expect.any(Object), {
            focusTitle: true,
            focusEventOnReturn: true,
        });
    });

    it("routes a month-view date to day view without creating", async () => {
        const openDay = jest.fn();
        const createTimedNote = jest.fn(async () => undefined);

        await handleCalendarSelection({
            start,
            end,
            viewType: "dayGridMonth",
            openDay,
            createTimedNote,
        });

        expect(openDay).toHaveBeenCalledWith(start);
        expect(createTimedNote).not.toHaveBeenCalled();
    });
});
