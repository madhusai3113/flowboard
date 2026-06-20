<script setup lang="ts">
import { ref } from "vue";
import type { ContainerNode } from "@flowboard/shared";

defineProps<{ node: ContainerNode; selectedId: string | null }>();
const emit = defineEmits<{ select: [node: ContainerNode] }>();
const expanded = ref(true);
</script>

<template>
  <li>
    <div
      class="tree-row"
      :class="{ selected: node.id === selectedId, restricted: node.restricted }"
    >
      <button
        v-if="node.children.length"
        class="tree-toggle"
        :aria-label="expanded ? 'Collapse' : 'Expand'"
        @click="expanded = !expanded"
      >
        {{ expanded ? "⌄" : "›" }}
      </button>
      <span v-else class="tree-spacer" />
      <button
        class="tree-label"
        :disabled="node.restricted || node.type !== 'list'"
        @click="emit('select', node)"
      >
        <span class="tree-icon">{{ node.restricted ? "⌁" : node.type === "list" ? "≡" : node.type === "folder" ? "▱" : "◆" }}</span>
        {{ node.name }}
      </button>
    </div>
    <ul v-if="expanded && node.children.length" class="tree-children">
      <TreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :selected-id="selectedId"
        @select="emit('select', $event)"
      />
    </ul>
  </li>
</template>
