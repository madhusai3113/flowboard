import type { ApiError, ContainerNode, Grant, Status, Task, User, UserAccess } from "@flowboard/shared";

let activeUser = localStorage.getItem("flowboard-user") ?? "alice";

interface ApiEnvelope<T> {
  data: T;
  meta?: {
    offset: number;
    limit: number;
    total: number;
  };
}

export function setActiveUser(userId: string) {
  activeUser = userId;
  localStorage.setItem("flowboard-user", userId);
}

async function requestEnvelope<T>(path: string, options: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": activeUser,
      ...options.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiError | null;
    throw new Error(body?.error?.message ?? "Request failed.");
  }
  return response.status === 204
    ? { data: undefined as T }
    : await response.json() as ApiEnvelope<T>;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await requestEnvelope<T>(path, options)).data;
}

async function allTasks(listId: string, sort: string, direction: string): Promise<Task[]> {
  const tasks: Task[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const page = await requestEnvelope<Task[]>(
      `/api/lists/${listId}/tasks?limit=${limit}&offset=${offset}&sort=${sort}&direction=${direction}`
    );
    tasks.push(...page.data);
    offset += page.data.length;
    if (!page.meta || offset >= page.meta.total || page.data.length === 0) return tasks;
  }
}

export const api = {
  users: () => request<User[]>("/api/users"),
  tree: () => request<ContainerNode[]>("/api/tree"),
  grants: () => request<Grant[]>("/api/grants"),
  access: (resourceId: string) => request<UserAccess[]>(`/api/containers/${resourceId}/access`),
  archivedContainers: () => request<Array<{
    id: string;
    name: string;
    type: ContainerNode["type"];
    parentId: string | null;
    position: number;
    visibility: ContainerNode["visibility"];
    archivedAt: string;
  }>>("/api/containers/archived"),
  createContainer: (body: unknown) =>
    request<unknown>("/api/containers", { method: "POST", body: JSON.stringify(body) }),
  updateContainer: (id: string, body: unknown) =>
    request<unknown>(`/api/containers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  moveContainer: (id: string, body: unknown) =>
    request<unknown>(`/api/containers/${id}/move`, { method: "POST", body: JSON.stringify(body) }),
  archiveContainer: (id: string) => request<void>(`/api/containers/${id}`, { method: "DELETE" }),
  restoreContainer: (id: string) => request<unknown>(`/api/containers/${id}/restore`, { method: "POST" }),
  setGrant: (resourceId: string, userId: string, mode: "allow" | "deny") =>
    request<unknown>(`/api/grants/${resourceId}/${userId}`, { method: "PUT", body: JSON.stringify({ mode }) }),
  deleteGrant: (resourceId: string, userId: string) =>
    request<void>(`/api/grants/${resourceId}/${userId}`, { method: "DELETE" }),
  statuses: (listId: string) => request<Status[]>(`/api/lists/${listId}/statuses`),
  createStatus: (listId: string, body: unknown) =>
    request<Status>(`/api/lists/${listId}/statuses`, { method: "POST", body: JSON.stringify(body) }),
  updateStatus: (statusId: string, body: unknown) =>
    request<Status>(`/api/statuses/${statusId}`, { method: "PATCH", body: JSON.stringify(body) }),
  reorderStatuses: (listId: string, orderedIds: string[]) =>
    request<void>(`/api/lists/${listId}/statuses/reorder`, {
      method: "PUT",
      body: JSON.stringify({ orderedIds })
    }),
  deleteStatus: (statusId: string) => request<void>(`/api/statuses/${statusId}`, { method: "DELETE" }),
  tasks: (listId: string, sort = "position", direction = "asc") =>
    allTasks(listId, sort, direction),
  createTask: (listId: string, body: unknown) =>
    request<Task>(`/api/lists/${listId}/tasks`, { method: "POST", body: JSON.stringify(body) }),
  updateTask: (taskId: string, body: unknown) =>
    request<Task>(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) }),
  moveTask: (taskId: string, body: unknown) =>
    request<Task>(`/api/tasks/${taskId}/move`, { method: "POST", body: JSON.stringify(body) }),
  deleteTask: (taskId: string) => request<void>(`/api/tasks/${taskId}`, { method: "DELETE" })
};
