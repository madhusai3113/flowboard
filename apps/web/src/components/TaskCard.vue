<script setup lang="ts">
import type { Task } from "@flowboard/shared";

defineProps<{ task: Task }>();
const emit = defineEmits<{ open: [task: Task]; drag: [task: Task] }>();

function dueLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value)) : "";
}
</script>

<template>
  <article
    class="task-card"
    draggable="true"
    tabindex="0"
    @dragstart="emit('drag', task)"
    @click="emit('open', task)"
    @keydown.enter="emit('open', task)"
  >
    <h3>{{ task.title }}</h3>
    <div class="card-meta">
      <span v-if="task.priority !== 'none'" class="priority" :class="task.priority">{{ task.priority }}</span>
      <span v-if="task.dueDate" class="due">{{ dueLabel(task.dueDate) }}</span>
      <span class="avatars">
        <span
          v-for="assignee in task.assignees"
          :key="assignee.id"
          class="avatar"
          :style="{ background: assignee.color }"
          :title="assignee.name"
        >{{ assignee.name.split(" ").map((part) => part[0]).slice(0, 2).join("") }}</span>
      </span>
    </div>
  </article>
</template>
