<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { ContainerNode, Priority, Status, Task, User, UserAccess } from "@flowboard/shared";
import { api } from "../api";

const props = defineProps<{
  task: Task | null;
  listId: string;
  statuses: Status[];
  users: User[];
  userAccess: UserAccess[];
  lists: ContainerNode[];
}>();
const emit = defineEmits<{
  close: [];
  save: [body: Record<string, unknown>];
  delete: [];
}>();

const form = reactive({
  destinationListId: props.task?.primaryListId ?? props.listId,
  title: props.task?.title ?? "",
  description: props.task?.description ?? "",
  statusId: props.task?.statusId ?? props.statuses[0]?.id ?? "",
  priority: (props.task?.priority ?? "none") as Priority,
  assigneeIds: [...(props.task?.assigneeIds ?? [])],
  dueDate: props.task?.dueDate ? props.task.dueDate.slice(0, 16) : ""
});
const availableStatuses = ref([...props.statuses]);
const availableAccess = ref([...props.userAccess]);
const listLoadingError = ref("");

const inaccessibleAssignees = computed(() => {
  const access = new Map(availableAccess.value.map((entry) => [entry.userId, entry.canAccess]));
  return props.users.filter((user) => form.assigneeIds.includes(user.id) && access.get(user.id) === false);
});

watch(() => form.destinationListId, async (listId) => {
  listLoadingError.value = "";
  try {
    if (listId === props.listId) {
      availableStatuses.value = [...props.statuses];
      availableAccess.value = [...props.userAccess];
    } else {
      [availableStatuses.value, availableAccess.value] = await Promise.all([
        api.statuses(listId),
        api.access(listId)
      ]);
    }
    if (!availableStatuses.value.some((status) => status.id === form.statusId)) {
      form.statusId = availableStatuses.value[0]?.id ?? "";
    }
  } catch (cause) {
    listLoadingError.value = cause instanceof Error ? cause.message : "Could not load destination list.";
  }
});

function toggleAssignee(id: string) {
  form.assigneeIds = form.assigneeIds.includes(id)
    ? form.assigneeIds.filter((value) => value !== id)
    : [...form.assigneeIds, id];
}

function submit() {
  emit("save", {
    ...form,
    description: form.description || null,
    dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null
  });
}
</script>

<template>
  <div class="drawer-backdrop" @click.self="emit('close')">
    <aside class="drawer" aria-label="Task details">
      <header>
        <div>
          <span class="eyebrow">{{ task ? "Task details" : "New task" }}</span>
          <h2>{{ task ? "Edit task" : "Create task" }}</h2>
        </div>
        <button class="icon-button" aria-label="Close" @click="emit('close')">×</button>
      </header>
      <form @submit.prevent="submit">
        <label>Title <input v-model="form.title" maxlength="500" required autofocus /></label>
        <label>Description <textarea v-model="form.description" rows="6" placeholder="Add context, notes, or acceptance criteria…" /></label>
        <label v-if="task">Primary list
          <select v-model="form.destinationListId">
            <option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option>
          </select>
        </label>
        <p v-if="listLoadingError" class="inline-error">{{ listLoadingError }}</p>
        <div class="form-grid">
          <label>Status
            <select v-model="form.statusId">
              <option v-for="status in availableStatuses" :key="status.id" :value="status.id">{{ status.name }}</option>
            </select>
          </label>
          <label>Priority
            <select v-model="form.priority">
              <option v-for="priority in ['urgent', 'high', 'normal', 'low', 'none']" :key="priority" :value="priority">{{ priority }}</option>
            </select>
          </label>
        </div>
        <label>Due date <input v-model="form.dueDate" type="datetime-local" /></label>
        <fieldset>
          <legend>Assignees</legend>
          <label v-for="user in users" :key="user.id" class="check-row">
            <input type="checkbox" :checked="form.assigneeIds.includes(user.id)" @change="toggleAssignee(user.id)" />
            <span class="avatar" :style="{ background: user.color }">{{ user.name[0] }}</span>
            {{ user.name }}
          </label>
        </fieldset>
        <p v-if="inaccessibleAssignees.length" class="access-warning" role="status">
          {{ inaccessibleAssignees.map((user) => user.name).join(", ") }}
          cannot see this list. Assignment does not grant access.
        </p>
        <div class="drawer-actions">
          <button v-if="task" type="button" class="danger-button" @click="emit('delete')">Delete</button>
          <span />
          <button type="button" class="secondary-button" @click="emit('close')">Cancel</button>
          <button class="primary-button" type="submit">{{ task ? "Save changes" : "Create task" }}</button>
        </div>
      </form>
    </aside>
  </div>
</template>
