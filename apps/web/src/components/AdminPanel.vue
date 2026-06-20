<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { ContainerNode, Grant, Status, User } from "@flowboard/shared";
import { api } from "../api";

const props = defineProps<{
  roots: ContainerNode[];
  users: User[];
  selectedList: ContainerNode | null;
  statuses: Status[];
}>();
const emit = defineEmits<{ close: []; changed: [] }>();

const busy = ref(false);
const error = ref("");
const grants = ref<Grant[]>([]);
const archived = ref<Awaited<ReturnType<typeof api.archivedContainers>>>([]);
const containerForm = reactive({
  name: "",
  type: "space" as "space" | "folder" | "list",
  parentId: "workspace",
  visibility: "public" as "public" | "private"
});
const grantForm = reactive({
  resourceId: "",
  userId: "bob",
  mode: "allow" as "allow" | "deny"
});
const statusForm = reactive({
  name: "",
  category: "not_started" as Status["category"],
  color: "#94a3b8"
});

function flatten(nodes: ContainerNode[]): ContainerNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

const containers = computed(() => flatten(props.roots));
const grantable = computed(() => containers.value.filter((node) => node.type !== "workspace"));
const members = computed(() => props.users.filter((user) => user.role === "member"));
const parentOptions = computed(() => {
  const parentType = containerForm.type === "space" ? "workspace" : containerForm.type === "folder" ? "space" : "folder";
  return containers.value.filter((node) => node.type === parentType);
});

async function loadAdminData() {
  [grants.value, archived.value] = await Promise.all([api.grants(), api.archivedContainers()]);
  if (!grantForm.resourceId) grantForm.resourceId = grantable.value[0]?.id ?? "";
  if (!parentOptions.value.some((node) => node.id === containerForm.parentId)) {
    containerForm.parentId = parentOptions.value[0]?.id ?? "";
  }
}

async function run(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = "";
  try {
    await action();
    await loadAdminData();
    emit("changed");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Admin action failed.";
  } finally {
    busy.value = false;
  }
}

function createContainer() {
  return run(async () => {
    await api.createContainer({ ...containerForm });
    containerForm.name = "";
  });
}

function setGrant() {
  return run(() => api.setGrant(grantForm.resourceId, grantForm.userId, grantForm.mode));
}

function addStatus() {
  if (!props.selectedList) return;
  return run(async () => {
    await api.createStatus(props.selectedList!.id, { ...statusForm });
    statusForm.name = "";
  });
}

function moveStatus(index: number, delta: number) {
  if (!props.selectedList) return;
  const ordered = props.statuses.map((status) => status.id);
  const target = index + delta;
  if (target < 0 || target >= ordered.length) return;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return run(() => api.reorderStatuses(props.selectedList!.id, ordered));
}

function moveContainer(node: ContainerNode, delta: number) {
  if (!node.parentId) return;
  const siblings = containers.value
    .filter((candidate) => candidate.parentId === node.parentId)
    .sort((a, b) => a.position - b.position);
  const index = siblings.findIndex((candidate) => candidate.id === node.id);
  const target = index + delta;
  if (target < 0 || target >= siblings.length) return;
  return run(() => api.moveContainer(node.id, { parentId: node.parentId, position: target }));
}

function renameContainer(node: ContainerNode) {
  const name = window.prompt("Container name", node.name)?.trim();
  if (!name || name === node.name) return;
  return run(() => api.updateContainer(node.id, { name }));
}

loadAdminData().catch((cause) => {
  error.value = cause instanceof Error ? cause.message : "Could not load admin settings.";
});
</script>

<template>
  <div class="drawer-backdrop" @click.self="emit('close')">
    <aside class="drawer admin-drawer" aria-label="Workspace administration">
      <header>
        <div><span class="eyebrow">Administration</span><h2>Workspace settings</h2></div>
        <button class="icon-button" aria-label="Close" @click="emit('close')">×</button>
      </header>

      <p v-if="error" class="inline-error">{{ error }}</p>

      <section class="admin-section">
        <h3>Create container</h3>
        <form @submit.prevent="createContainer">
          <label>Name <input v-model="containerForm.name" required maxlength="200" /></label>
          <div class="form-grid">
            <label>Type
              <select v-model="containerForm.type" @change="containerForm.parentId = parentOptions[0]?.id ?? ''">
                <option value="space">Space</option>
                <option value="folder">Folder</option>
                <option value="list">List</option>
              </select>
            </label>
            <label>Visibility
              <select v-model="containerForm.visibility">
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </label>
          </div>
          <label>Parent
            <select v-model="containerForm.parentId" required>
              <option v-for="node in parentOptions" :key="node.id" :value="node.id">{{ node.name }}</option>
            </select>
          </label>
          <button class="primary-button" :disabled="busy || !containerForm.parentId">Create</button>
        </form>
      </section>

      <section class="admin-section">
        <h3>Access grants</h3>
        <form @submit.prevent="setGrant">
          <label>Resource
            <select v-model="grantForm.resourceId">
              <option v-for="node in grantable" :key="node.id" :value="node.id">{{ node.name }} · {{ node.type }}</option>
            </select>
          </label>
          <div class="form-grid">
            <label>Member
              <select v-model="grantForm.userId">
                <option v-for="user in members" :key="user.id" :value="user.id">{{ user.name }}</option>
              </select>
            </label>
            <label>Mode
              <select v-model="grantForm.mode"><option value="allow">Allow</option><option value="deny">Deny</option></select>
            </label>
          </div>
          <button class="primary-button" :disabled="busy || !grantForm.resourceId">Save grant</button>
        </form>
        <div class="admin-rows">
          <div v-for="grant in grants" :key="`${grant.resourceId}-${grant.userId}`" class="admin-row">
            <span><strong>{{ grant.userName }}</strong> · {{ grant.mode }} · {{ grant.resourceName }}</span>
            <button class="text-button" :disabled="busy" @click="run(() => api.deleteGrant(grant.resourceId, grant.userId))">Remove</button>
          </div>
        </div>
      </section>

      <section v-if="selectedList" class="admin-section">
        <h3>{{ selectedList.name }} statuses</h3>
        <div class="admin-rows">
          <div v-for="(status, index) in statuses" :key="status.id" class="admin-row">
            <span><i class="status-dot" :style="{ background: status.color }" />{{ status.name }}</span>
            <span>
              <button class="text-button" :disabled="busy || index === 0" @click="moveStatus(index, -1)">↑</button>
              <button class="text-button" :disabled="busy || index === statuses.length - 1" @click="moveStatus(index, 1)">↓</button>
              <button class="text-button danger-text" :disabled="busy" @click="run(() => api.deleteStatus(status.id))">Delete</button>
            </span>
          </div>
        </div>
        <form @submit.prevent="addStatus">
          <label>Name <input v-model="statusForm.name" required maxlength="100" /></label>
          <div class="form-grid">
            <label>Category
              <select v-model="statusForm.category">
                <option value="not_started">Not started</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <label>Color <input v-model="statusForm.color" type="color" /></label>
          </div>
          <button class="secondary-button" :disabled="busy">Add status</button>
        </form>
      </section>

      <section class="admin-section">
        <h3>Manage containers</h3>
        <div class="admin-rows">
          <div v-for="node in grantable" :key="node.id" class="admin-row">
            <span>{{ node.name }} · {{ node.type }}</span>
            <span>
              <button class="text-button" :disabled="busy" @click="moveContainer(node, -1)">↑</button>
              <button class="text-button" :disabled="busy" @click="moveContainer(node, 1)">↓</button>
              <button class="text-button" :disabled="busy" @click="renameContainer(node)">Rename</button>
              <button class="text-button" :disabled="busy" @click="run(() => api.updateContainer(node.id, { visibility: node.visibility === 'public' ? 'private' : 'public' }))">
                Make {{ node.visibility === "public" ? "private" : "public" }}
              </button>
              <button class="text-button danger-text" :disabled="busy" @click="run(() => api.archiveContainer(node.id))">Archive</button>
            </span>
          </div>
        </div>
        <h4 v-if="archived.length">Archived containers</h4>
        <div class="admin-rows">
          <div v-for="node in archived" :key="node.id" class="admin-row">
            <span>{{ node.name }} · {{ node.type }}</span>
            <button class="text-button" :disabled="busy" @click="run(() => api.restoreContainer(node.id))">Restore</button>
          </div>
        </div>
      </section>
    </aside>
  </div>
</template>
