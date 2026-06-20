<script setup lang="ts">
import { ref } from "vue";
import type { Status, Task } from "@flowboard/shared";
import TaskCard from "./TaskCard.vue";

const props = defineProps<{ statuses: Status[]; tasks: Task[] }>();
const emit = defineEmits<{
  open: [task: Task];
  move: [task: Task, statusId: string, position: number];
}>();
const dragging = ref<Task | null>(null);

function tasksFor(statusId: string) {
  return props.tasks.filter((task) => task.statusId === statusId).sort((a, b) => a.position - b.position);
}

function drop(statusId: string, position: number) {
  if (dragging.value) emit("move", dragging.value, statusId, position);
  dragging.value = null;
}
</script>

<template>
  <section class="kanban" aria-label="Kanban board">
    <div
      v-for="status in statuses"
      :key="status.id"
      class="kanban-column"
      @dragover.prevent
      @drop.prevent="drop(status.id, tasksFor(status.id).length)"
    >
      <header class="column-header">
        <span class="status-dot" :style="{ background: status.color }" />
        <h2>{{ status.name }}</h2>
        <span>{{ tasksFor(status.id).length }}</span>
      </header>
      <div class="column-cards">
        <div
          v-for="(task, index) in tasksFor(status.id)"
          :key="task.id"
          @dragover.prevent
          @drop.stop.prevent="drop(status.id, index)"
        >
          <TaskCard :task="task" @open="emit('open', $event)" @drag="dragging = $event" />
        </div>
        <p v-if="!tasksFor(status.id).length" class="empty-column">Drop a task here</p>
      </div>
    </div>
  </section>
</template>
