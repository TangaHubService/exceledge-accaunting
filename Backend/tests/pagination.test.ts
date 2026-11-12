import { describe, expect, it } from "vitest";
import { normalizePage, pageArgs, pageResult, paginateArray, parsePage, wantsPage } from "../src/lib/pagination";

describe("shared pagination helper", () => {
  it("clamps page and page size, falling back to defaults on bad input", () => {
    expect(normalizePage({})).toEqual({ page: 1, pageSize: 50 });
    expect(normalizePage({ page: "3", pageSize: "25" })).toEqual({ page: 3, pageSize: 25 });
    expect(normalizePage({ page: "0", pageSize: "-5" })).toEqual({ page: 1, pageSize: 50 });
    expect(normalizePage({ page: "abc", pageSize: "9999" }, { maxSize: 100 })).toEqual({ page: 1, pageSize: 100 });
    expect(normalizePage({}, { defaultSize: 500, maxSize: 200 })).toEqual({ page: 1, pageSize: 200 });
  });

  it("reads Express-style queries and knows when a page was asked for", () => {
    expect(parsePage({ page: ["2", "9"], pageSize: "10" })).toEqual({ page: 2, pageSize: 10 });
    expect(wantsPage({ q: "x" })).toBe(false);
    expect(wantsPage({ page: "1" })).toBe(true);
  });

  it("builds skip/take and the standard reply", () => {
    expect(pageArgs({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 });
    expect(pageResult(["a"], 41, { page: 3, pageSize: 20 })).toEqual({ rows: ["a"], total: 41, page: 3, pageSize: 20, pageCount: 3 });
    expect(pageResult([], 0, { page: 1, pageSize: 20 }).pageCount).toBe(1);
  });

  it("pages in-memory lists and returns the last page when asked past the end", () => {
    const items = Array.from({ length: 23 }, (_, i) => i + 1);
    expect(paginateArray(items, { page: 2, pageSize: 10 }).rows).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const past = paginateArray(items, { page: 9, pageSize: 10 });
    expect(past).toMatchObject({ page: 3, pageCount: 3, total: 23, rows: [21, 22, 23] });
  });
});
