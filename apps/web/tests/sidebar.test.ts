import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SidebarTree from "../src/components/SidebarTree.vue";

describe("SidebarTree", () => {
  it("renders restricted ancestors as disabled shells while keeping an allowed list selectable", async () => {
    const wrapper = mount(SidebarTree, {
      props: {
        selectedId: null,
        roots: [{
          id: "workspace",
          name: "Flowboard",
          type: "workspace",
          parentId: null,
          position: 0,
          visibility: "public",
          children: [{
            id: "restricted-space",
            name: "Restricted",
            type: "space",
            parentId: "workspace",
            position: 0,
            visibility: "public",
            restricted: true,
            children: [{
              id: "list-backlog",
              name: "Backlog",
              type: "list",
              parentId: "restricted-space",
              position: 0,
              visibility: "public",
              children: []
            }]
          }]
        }]
      }
    });

    expect(wrapper.text()).toContain("Restricted");
    expect(wrapper.find(".tree-row.restricted button.tree-label").attributes("disabled")).toBeDefined();
    await wrapper.findAll("button.tree-label").at(-1)!.trigger("click");
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({ id: "list-backlog" });
  });
});
