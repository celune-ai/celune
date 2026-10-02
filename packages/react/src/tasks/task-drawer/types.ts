import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskAssignee,
  TaskComment,
  TaskMetadata,
  ActivityEntry,
  AgentMemory,
} from '@repo/types';

export type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskAssignee,
  TaskComment,
  TaskMetadata,
  AgentMemory,
};

export interface TaskFormState {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: TaskAssignee;
  dueDate: string;
  dependsOn: string[];
}

export type FeedItem =
  { kind: 'comment'; data: TaskComment } | { kind: 'activity'; data: ActivityEntry };
