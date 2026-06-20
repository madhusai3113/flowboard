<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { ContainerNode, Status, Task, User, UserAccess } from "@flowboard/shared";
import { api, setActiveUser } from "./api";
import SidebarTree from "./components/SidebarTree.vue";
import KanbanBoard from "./components/KanbanBoard.vue";
import TaskList from "./components/TaskList.vue";
import TaskDrawer from "./components/TaskDrawer.vue";
import AdminPanel from "./components/AdminPanel.vue";

const users = ref<User[]>([]);
const currentUserId = ref(localStorage.getItem("flowboard-user") ?? "alice");
const roots = ref<ContainerNode[]>([]);
const selectedList = ref<ContainerNode | null>(null);
const statuses = ref<Status[]>([]);
const tasks = ref<Task[]>([]);
const view = ref<"board" | "list">((new URLSearchParams(location.search).get("view") as "board" | "list") ?? "board");
const openTask = ref<Task | null | undefined>(undefined);
const loading = ref(true);
const error = ref("");
const sort = ref("position");
const direction = ref("asc");
const userAccess = ref<UserAccess[]>([]);
const adminOpen = ref(false);

const currentUser = computed(() => users.value.find((user) => user.id === currentUserId.value));
const accessibleLists = computed(() => allLists(roots.value));

function allLists(nodes: ContainerNode[]): ContainerNode[] {
  return nodes.flatMap((node) => [
    ...(node.type === "list" && !node.restricted ? [node] : []),
    ...allLists(node.children)
  ]);
}

function updateUrl() {
  const params = new URLSearchParams();
  if (selectedList.value) params.set("list", selectedList.value.id);
  params.set("view", view.value);
  history.replaceState(null, "", `?${params}`);
}

async function loadList() {
  if (!selectedList.value) {
    statuses.value = [];
    tasks.value = [];
    userAccess.value = [];
    return;
  }
  const [nextStatuses, nextTasks, nextAccess] = await Promise.all([
    api.statuses(selectedList.value.id),
    api.tasks(selectedList.value.id, sort.value, direction.value),
    api.access(selectedList.value.id)
  ]);
  statuses.value = nextStatuses;
  tasks.value = nextTasks;
  userAccess.value = nextAccess;
  updateUrl();
}

async function refreshWorkspace(preferredListId?: string | null) {
  loading.value = true;
  error.value = "";
  try {
    roots.value = await api.tree();
    const lists = allLists(roots.value);
    const requested = preferredListId ?? new URLSearchParams(location.search).get("list");
    selectedList.value = lists.find((list) => list.id === requested) ?? lists[0] ?? null;
    await loadList();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Could not load Flowboard.";
  } finally {
    loading.value = false;
  }
}

async function chooseUser(userId: string) {
  currentUserId.value = userId;
  setActiveUser(userId);
  openTask.value = undefined;
  await refreshWorkspace();
}

async function chooseList(node: ContainerNode) {
  selectedList.value = node;
  sort.value = "position";
  direction.value = "asc";
  await loadList();
}

function chooseView(next: "board" | "list") {
  view.value = next;
  updateUrl();
}

async function moveTask(task: Task, statusId: string, position: number) {
  if (!selectedList.value) return;
  const snapshot = tasks.value.map((item) => ({ ...item }));
  const remaining = tasks.value.filter((item) => item.id !== task.id);
  const destination = remaining.filter((item) => item.statusId === statusId).sort((a, b) => a.position - b.position);
  destination.splice(position, 0, { ...task, statusId });
  destination.forEach((item, index) => { item.position = index; });
  tasks.value = remaining.filter((item) => item.statusId !== statusId).concat(destination);
  try {
    await api.moveTask(task.id, { listId: selectedList.value.id, statusId, position });
    await loadList();
  } catch (cause) {
    tasks.value = snapshot;
    error.value = cause instanceof Error ? cause.message : "Could not move task.";
  }
}

async function saveTask(body: Record<string, unknown>) {
  if (!selectedList.value) return;
  error.value = "";
  try {
    const destinationListId = typeof body.destinationListId === "string"
      ? body.destinationListId
      : selectedList.value.id;
    const taskBody = { ...body };
    delete taskBody.destinationListId;
    if (openTask.value) {
      await api.updateTask(openTask.value.id, {
        ...taskBody,
        primaryListId: destinationListId,
        ...(destinationListId !== openTask.value.primaryListId ? { position: 1_000_000 } : {})
      });
    } else {
      await api.createTask(selectedList.value.id, taskBody);
    }
    openTask.value = undefined;
    await loadList();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Could not save task.";
  }
}

async function deleteTask() {
  if (!openTask.value || !confirm(`Delete “${openTask.value.title}”?`)) return;
  try {
    await api.deleteTask(openTask.value.id);
    openTask.value = undefined;
    await loadList();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Could not delete task.";
  }
}

async function changeSort(field: "dueDate" | "priority") {
  direction.value = sort.value === field && direction.value === "asc" ? "desc" : "asc";
  sort.value = field;
  await loadList();
}

onMounted(async () => {
  setActiveUser(currentUserId.value);
  try {
    users.value = await api.users();
  } catch {
    currentUserId.value = "alice";
    setActiveUser("alice");
    users.value = await api.users();
  }
  await refreshWorkspace();
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">F</span>
        <div><strong>Flowboard</strong></div>
      </div>
      <div class="workspace-label">Workspace</div>
      <SidebarTree :roots="roots" :selected-id="selectedList?.id ?? null" @select="chooseList" />
      <div class="permission-note">
        <span>⌁</span>
        Restricted paths reveal structure, never content.
      </div>
      <div class="user-switcher">
        <label for="user">Viewing as</label>
        <select id="user" :value="currentUserId" @change="chooseUser(($event.target as HTMLSelectElement).value)">
          <option v-for="user in users" :key="user.id" :value="user.id">{{ user.name }} · {{ user.role }}</option>
        </select>
        <div v-if="currentUser" class="active-user">
          <span class="avatar" :style="{ background: currentUser.color }">{{ currentUser.name[0] }}</span>
          <span><strong>{{ currentUser.name }}</strong><small>{{ currentUser.role === "admin" ? "Full workspace access" : "Grant-based access" }}</small></span>
        </div>
      </div>
    </aside>

    <main class="main-content">
      <header class="topbar">
        <div>
          <span class="eyebrow">List</span>
          <h1>{{ selectedList?.name ?? "No accessible lists" }}</h1>
        </div>
        <div class="topbar-actions">
          <div class="view-toggle" aria-label="Choose view">
            <button :class="{ active: view === 'board' }" @click="chooseView('board')">Board</button>
            <button :class="{ active: view === 'list' }" @click="chooseView('list')">List</button>
          </div>
          <button v-if="currentUser?.role === 'admin'" class="secondary-button" @click="adminOpen = true">Workspace settings</button>
          <button class="primary-button" :disabled="!selectedList" @click="openTask = null">＋ New task</button>
        </div>
      </header>

      <div v-if="error" class="error-banner" role="alert">
        {{ error }} <button @click="error = ''">Dismiss</button>
      </div>
      <div v-if="loading" class="loading-state"><span class="spinner" /> Loading workspace…</div>
      <div v-else-if="!selectedList" class="empty-state">
        <span>◇</span><h2>No lists available</h2><p>This user has no list grants in the current workspace.</p>
      </div>
      <template v-else>
        <KanbanBoard
          v-if="view === 'board'"
          :statuses="statuses"
          :tasks="tasks"
          @open="openTask = $event"
          @move="moveTask"
        />
        <TaskList
          v-else
          :tasks="tasks"
          :statuses="statuses"
          :sort="sort"
          :direction="direction"
          @open="openTask = $event"
          @sort="changeSort"
        />
      </template>
    </main>

    <TaskDrawer
      v-if="openTask !== undefined && selectedList"
      :key="openTask?.id ?? 'new'"
      :task="openTask"
      :list-id="selectedList.id"
      :statuses="statuses"
      :users="users"
      :user-access="userAccess"
      :lists="accessibleLists"
      @close="openTask = undefined"
      @save="saveTask"
      @delete="deleteTask"
    />
    <AdminPanel
      v-if="adminOpen && currentUser?.role === 'admin'"
      :roots="roots"
      :users="users"
      :selected-list="selectedList"
      :statuses="statuses"
      @close="adminOpen = false"
      @changed="refreshWorkspace(selectedList?.id)"
    />
  </div>
</template>
