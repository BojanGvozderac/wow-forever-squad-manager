import { describe, expect, it } from "vitest";
import {
  addDays,
  localTimeCandidates,
  mondayOf,
  overlapsDay,
  weekRange,
} from "./calendar";
describe("calendar dates and timezone resolution", () => {
  it("moves calendar dates across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
  });
  it("rejects nonexistent DST times and invalid dates", () => {
    expect(localTimeCandidates("2026-03-29T02:30", "Europe/Berlin")).toEqual(
      [],
    );
    expect(localTimeCandidates("2026-02-30T12:00", "Europe/Berlin")).toEqual(
      [],
    );
  });
  it("offers both DST fold offsets", () => {
    expect(localTimeCandidates("2026-10-25T02:30", "Europe/Berlin")).toEqual([
      Date.parse("2026-10-25T00:30:00Z"),
      Date.parse("2026-10-25T01:30:00Z"),
    ]);
  });
  it("uses local dates for weeks crossing DST", () => {
    const spring = weekRange("2026-03-23", "Europe/Berlin");
    const autumn = weekRange("2026-10-19", "Europe/Berlin");
    expect((spring.to - spring.from) / 3600000).toBe(167);
    expect((autumn.to - autumn.from) / 3600000).toBe(169);
  });
  it("includes overnight slots but excludes an exact ending boundary", () => {
    const start = Date.parse("2026-10-19T21:00:00Z");
    const end = Date.parse("2026-10-19T23:00:00Z");
    expect(overlapsDay(start, end, "2026-10-20", "Europe/Berlin")).toBe(true);
    expect(
      overlapsDay(
        start,
        Date.parse("2026-10-19T22:00:00Z"),
        "2026-10-20",
        "Europe/Berlin",
      ),
    ).toBe(false);
  });
});
