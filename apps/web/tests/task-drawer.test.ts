import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TaskDrawer from "../src/components/TaskDrawer.vue";

describe("TaskDrawer", () => {
  it("warns when an assignee cannot access the task list", async () => {
    const wrapper = mount(TaskDrawer, {
      props: {
        task: null,
        listId: "list-sprint",
        statuses: [{
          id: "todo",
          listId: "list-sprint",
          name: "To do",
          category: "not_started",
          color: "#94a3b8",
          position: 0
        }],
        users: [
          { id: "alice", name: "Alice Admin", role: "admin", color: "#000000" },
          { id: "carol", name: "Carol Chen", role: "member", color: "#ffffff" }
        ],
        userAccess: [
          { userId: "alice", canAccess: true, explicitMode: null },
          { userId: "carol", canAccess: false, explicitMode: null }
        ],
        lists: [{
          id: "list-sprint",
          name: "Sprint",
          type: "list",
          parentId: "folder",
          position: 0,
          visibility: "public",
          children: []
        }]
      }
    });

    await wrapper.findAll('input[type="checkbox"]')[1].setValue(true);
    expect(wrapper.text()).toContain("Carol Chen cannot see this list");
    expect(wrapper.text()).toContain("Assignment does not grant access");
  });
});
