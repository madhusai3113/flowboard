import { z } from "zod";

export const containerTypes = ["workspace", "space", "folder", "list"] as const;
export const priorities = ["urgent", "high", "normal", "low", "none"] as const;
export const statusCategories = ["not_started", "active", "completed"] as const;
export const grantModes = ["allow", "deny"] as const;

export type ContainerType = (typeof containerTypes)[number];
export type Priority = (typeof priorities)[number];
export type StatusCategory = (typeof statusCategories)[number];

export interface User {
  id: string;
  name: string;
  role: "admin" | "member";
  color: string;
}

export interface ContainerNode {
  id: string;
  name: string;
  type: ContainerType;
  parentId: string | null;
  position: number;
  visibility: "public" | "private";
  restricted?: boolean;
  children: ContainerNode[];
}

export interface Status {
  id: string;
  listId: string;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
}

export interface Grant {
  resourceId: string;
  resourceName: string;
  resourceType: Exclude<ContainerType, "workspace">;
  userId: string;
  userName: string;
  mode: "allow" | "deny";
}

export interface UserAccess {
  userId: string;
  canAccess: boolean;
  explicitMode: "allow" | "deny" | null;
}

export interface Task {
  id: string;
  primaryListId: string;
  title: string;
  description: string | null;
  statusId: string;
  priority: Priority;
  assigneeIds: string[];
  assignees: User[];
  dueDate: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).nullable().optional(),
  statusId: z.string().min(1),
  priority: z.enum(priorities).default("none"),
  assigneeIds: z.array(z.string()).default([]),
  dueDate: z.string().datetime({ offset: true }).nullable().optional()
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  primaryListId: z.string().min(1).optional(),
  position: z.number().int().min(0).optional()
});

export const moveTaskSchema = z.object({
  listId: z.string().min(1),
  statusId: z.string().min(1),
  position: z.number().int().min(0)
});

export const containerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(containerTypes),
  parentId: z.string().nullable(),
  visibility: z.enum(["public", "private"]).default("public")
});

export const updateContainerSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  visibility: z.enum(["public", "private"]).optional()
});

export const moveContainerSchema = z.object({
  parentId: z.string().nullable(),
  position: z.number().int().min(0)
});

export const statusSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(statusCategories),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  position: z.number().int().min(0).optional()
});

export const reorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1)
});

export const grantSchema = z.object({
  mode: z.enum(grantModes)
});

export interface ApiError {
  error: { code: string; message: string };
}
