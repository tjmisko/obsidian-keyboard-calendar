import { activateDayCalendarSidebar } from "./day_sidebar";

describe("day calendar sidebar activation", () => {
    const date = new Date(2026, 7, 25);

    it("creates the view in the right dock and navigates it", async () => {
        const leaf = { id: "right" };
        const view = { goToDate: jest.fn() };
        const operations = {
            getExistingLeaves: jest.fn(() => []),
            getRightLeaf: jest.fn(() => leaf),
            setDayView: jest.fn(async () => undefined),
            getDayView: jest.fn(() => view),
            revealLeaf: jest.fn(),
        };

        await expect(
            activateDayCalendarSidebar(date, operations)
        ).resolves.toBe(leaf);
        expect(operations.getRightLeaf).toHaveBeenCalledTimes(1);
        expect(operations.setDayView).toHaveBeenCalledWith(leaf);
        expect(operations.revealLeaf).toHaveBeenCalledWith(leaf);
        expect(view.goToDate).toHaveBeenCalledWith(date);
    });

    it("reuses an existing sidebar leaf without replacing its view", async () => {
        const leaf = { id: "existing" };
        const view = { goToDate: jest.fn() };
        const operations = {
            getExistingLeaves: jest.fn(() => [leaf]),
            getRightLeaf: jest.fn(),
            setDayView: jest.fn(async () => undefined),
            getDayView: jest.fn(() => view),
            revealLeaf: jest.fn(),
        };

        await activateDayCalendarSidebar(date, operations);

        expect(operations.getRightLeaf).not.toHaveBeenCalled();
        expect(operations.setDayView).not.toHaveBeenCalled();
        expect(operations.revealLeaf).toHaveBeenCalledWith(leaf);
        expect(view.goToDate).toHaveBeenCalledWith(date);
    });
});
