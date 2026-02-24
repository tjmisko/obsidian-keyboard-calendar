import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { OFCEvent } from "../../types";

interface EditRetendEventProps {
    submit: (frontmatter: OFCEvent) => Promise<void>;
    initialEvent?: Partial<OFCEvent>;
    categories: Record<string, string>;
    deleteEvent?: () => Promise<void>;
}

export const EditRetendEvent = ({
    initialEvent,
    submit,
    deleteEvent,
    categories,
}: EditRetendEventProps) => {
    const [title, setTitle] = useState(initialEvent?.title || "");
    const [category, setCategory] = useState(
        (initialEvent as any)?.category || ""
    );
    const [customCategory, setCustomCategory] = useState("");
    const [useCustom, setUseCustom] = useState(false);

    const date = initialEvent?.type === "single" ? initialEvent.date || "" : "";
    const startTime =
        initialEvent && !initialEvent.allDay
            ? (initialEvent as any).startTime || ""
            : "";
    const endTime =
        initialEvent && !initialEvent.allDay
            ? (initialEvent as any).endTime || ""
            : "";

    const titleRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (titleRef.current) {
            titleRef.current.focus();
        }
    }, [titleRef]);

    const categoryNames = Object.keys(categories);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const finalCategory = useCustom ? customCategory : category;
        await submit({
            title,
            category: finalCategory,
            type: "single",
            allDay: false,
            startTime,
            endTime,
            date,
            endDate: null,
        });
    };

    return (
        <form onSubmit={handleSubmit}>
            <p>
                <input
                    ref={titleRef}
                    type="text"
                    id="retend-title"
                    value={title}
                    placeholder="Activity title"
                    required
                    onChange={(e) => setTitle(e.target.value)}
                />
            </p>
            <p>
                <label htmlFor="retend-category">Category </label>
                {!useCustom ? (
                    <select
                        id="retend-category"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                    >
                        <option value="">-- Select --</option>
                        {categoryNames.map((name) => (
                            <option key={name} value={name}>
                                {name}
                            </option>
                        ))}
                    </select>
                ) : (
                    <input
                        type="text"
                        id="retend-custom-category"
                        value={customCategory}
                        placeholder="New category"
                        onChange={(e) => setCustomCategory(e.target.value)}
                    />
                )}
                <label style={{ marginLeft: "0.5rem" }}>
                    <input
                        type="checkbox"
                        checked={useCustom}
                        onChange={(e) => setUseCustom(e.target.checked)}
                    />{" "}
                    Custom
                </label>
            </p>
            <p style={{ color: "var(--text-muted)" }}>
                {date} {startTime && `${startTime} - ${endTime}`}
            </p>
            <p
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    width: "100%",
                }}
            >
                <button type="submit">Save</button>
                <span>
                    {deleteEvent && (
                        <button
                            type="button"
                            style={{
                                backgroundColor: "var(--interactive-normal)",
                                color: "var(--background-modifier-error)",
                                borderColor: "var(--background-modifier-error)",
                                borderWidth: "1px",
                                borderStyle: "solid",
                            }}
                            onClick={deleteEvent}
                        >
                            Delete
                        </button>
                    )}
                </span>
            </p>
        </form>
    );
};
