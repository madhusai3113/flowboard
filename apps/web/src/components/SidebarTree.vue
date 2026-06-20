<script setup lang="ts">
import type { ContainerNode } from "@flowboard/shared";
import TreeNode from "./TreeNode.vue";

defineProps<{ roots: ContainerNode[]; selectedId: string | null }>();
const emit = defineEmits<{ select: [node: ContainerNode] }>();
</script>

<template>
  <nav aria-label="Workspace hierarchy">
    <ul class="tree-root">
      <TreeNode
        v-for="node in roots"
        :key="node.id"
        :node="node"
        :selected-id="selectedId"
        @select="emit('select', $event)"
      />
    </ul>
  </nav>
</template>
