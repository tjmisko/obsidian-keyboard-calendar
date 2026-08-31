const mockButtons: Array<{
    text: string;
    cta: boolean;
    disabled: boolean;
    buttonEl: { focus: jest.Mock };
    click: () => Promise<void> | void;
}> = [];

jest.mock("obsidian", () => {
    class MockButtonComponent {
        text = "";
        cta = false;
        disabled = false;
        buttonEl = { focus: jest.fn() };
        click: () => Promise<void> | void = () => undefined;

        setButtonText(text: string) {
            this.text = text;
            return this;
        }

        setCta() {
            this.cta = true;
            return this;
        }

        setDisabled(disabled: boolean) {
            this.disabled = disabled;
            return this;
        }

        onClick(click: () => Promise<void> | void) {
            this.click = click;
            return this;
        }
    }

    class MockSetting {
        addButton(configure: (button: MockButtonComponent) => void) {
            const button = new MockButtonComponent();
            mockButtons.push(button);
            configure(button);
            return this;
        }
    }

    class MockModal {
        titleEl = { setText: jest.fn() };
        contentEl = { empty: jest.fn(), createEl: jest.fn() };
        closed = false;

        close() {
            this.closed = true;
            (this as any).onClose?.();
        }
    }

    return {
        ButtonComponent: MockButtonComponent,
        Modal: MockModal,
        Setting: MockSetting,
    };
});

import type { App } from "obsidian";
import { EventOccurrenceConfirmationModal } from "./event_occurrence_confirmation";

describe("event occurrence confirmation modal", () => {
    beforeEach(() => {
        mockButtons.length = 0;
    });

    it("focuses confirmation first and places Cancel one Tab later", async () => {
        const confirm = jest.fn(async () => true);
        const onClose = jest.fn();
        const modal = new EventOccurrenceConfirmationModal({} as App, {
            action: "omit",
            title: "Circle Left",
            date: "2026-09-05",
            confirm,
            onClose,
        });

        modal.onOpen();

        expect(mockButtons.map(({ text }) => text)).toEqual([
            "Omit occurrence",
            "Cancel",
        ]);
        expect(mockButtons[0].cta).toBe(true);
        expect(mockButtons[0].buttonEl.focus).toHaveBeenCalledTimes(1);
        await mockButtons[0].click();
        expect(confirm).toHaveBeenCalledTimes(1);
        expect((modal as any).closed).toBe(true);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("cancels without applying attendance", () => {
        const confirm = jest.fn(async () => true);
        const modal = new EventOccurrenceConfirmationModal({} as App, {
            action: "attend",
            title: "Dance",
            date: "2026-09-05",
            confirm,
        });

        modal.onOpen();
        mockButtons[1].click();

        expect(mockButtons.map(({ text }) => text)).toEqual([
            "Attend occurrence",
            "Cancel",
        ]);
        expect(confirm).not.toHaveBeenCalled();
        expect((modal as any).closed).toBe(true);
    });
});
