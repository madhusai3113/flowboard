import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api";

describe("API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads every page of tasks instead of truncating at 100", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), "http://flowboard.test");
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const count = offset === 0 ? 100 : 50;
      const data = Array.from({ length: count }, (_, index) => ({
        id: `task-${offset + index}`,
        primaryListId: "list-backlog",
        title: `Task ${offset + index}`,
        description: null,
        statusId: "todo",
        priority: "none",
        assigneeIds: [],
        assignees: [],
        dueDate: null,
        position: offset + index,
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z"
      }));
      return new Response(JSON.stringify({
        data,
        meta: { offset, limit: 100, total: 150 }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tasks = await api.tasks("list-backlog");

    expect(tasks).toHaveLength(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("offset=100");
  });
});
