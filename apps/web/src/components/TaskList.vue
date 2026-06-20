<script setup lang="ts">
import type { Status, Task } from "@flowboard/shared";

defineProps<{ tasks: Task[]; statuses: Status[]; sort: string; direction: string }>();
const emit = defineEmits<{
  open: [task: Task];
  sort: [field: "dueDate" | "priority"];
}>();

function statusName(statuses: Status[], id: string) {
  return statuses.find((status) => status.id === id)?.name ?? "Unknown";
}
</script>

<template>
  <div class="task-table-wrap">
    <table class="task-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Status</th>
          <th>Assignees</th>
          <th><button @click="emit('sort', 'priority')">Priority {{ sort === "priority" ? (direction === "asc" ? "↑" : "↓") : "" }}</button></th>
          <th><button @click="emit('sort', 'dueDate')">Due date {{ sort === "dueDate" ? (direction === "asc" ? "↑" : "↓") : "" }}</button></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="task in tasks" :key="task.id" tabindex="0" @click="emit('open', task)" @keydown.enter="emit('open', task)">
          <td class="task-title-cell">{{ task.title }}</td>
          <td>{{ statusName(statuses, task.statusId) }}</td>
          <td>{{ task.assignees.map((user) => user.name.split(" ")[0]).join(", ") || "—" }}</td>
          <td><span class="priority" :class="task.priority">{{ task.priority }}</span></td>
          <td>{{ task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—" }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
