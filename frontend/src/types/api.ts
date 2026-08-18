// Task Types
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue';
export type TaskType = 'assignment' | 'test' | 'exam' | 'project' | 'presentation' | 'report' | 'competition' | 'other';
export type TaskDifficulty = 'easy' | 'medium' | 'hard' | 'very_hard';

export interface Task {
  task_id: string;
  user_id: string;
  module_id?: string | null;
  title: string;
  description?: string | null;
  task_type: TaskType;
  deadline: string;
  estimated_hours?: number | null;
  grade_weight?: number | null;
  difficulty: TaskDifficulty;
  is_group_work: boolean;
  status: TaskStatus;
  progress_percentage: number;
  priority_score: number;
  created_at: string;
  updated_at: string;
  days_until_deadline?: number;
}

export interface Module {
  module_id: string;
  user_id: string;
  module_code: string;
  module_name: string;
  color: string;
  created_at: string;
  task_count?: number;
  active_task_count?: number;
}

export interface DashboardStatistics {
  total_tasks: number;
  completed_tasks: number;
  in_progress_tasks: number;
  not_started_tasks: number;
  overdue_tasks: number;
  actual_overdue: number;
  due_today: number;
  due_this_week: number;
  total_estimated_hours: number;
  avg_priority: number;
  completion_rate: number;
}

export interface DashboardModuleSummary {
  module_code: string;
  module_name: string;
  color: string;
  total_tasks: number;
  completed_tasks: number;
  active_tasks: number;
}

export interface DashboardWorkloadWeek {
  week_start: string;
  task_count: number;
  total_hours: number;
  high_priority_count: number;
}

export interface DashboardData {
  statistics: DashboardStatistics;
  upcoming_tasks: Task[];
  tasks_by_module: DashboardModuleSummary[];
  workload_by_week: DashboardWorkloadWeek[];
  recently_completed: Task[];
  high_priority_tasks: Task[];
}


export type GroupRole = 'owner' | 'member';
export type GroupTaskStatus = 'not_started' | 'in_progress' | 'completed';

export interface GroupMember {
  user_id: string;
  display_name: string;
  role: GroupRole;
  joined_at: string;
}

export interface GroupInvitation {
  group_id: string;
  group_name: string;
  group_description: string;
  group_color: string;
  invited_by_name: string;
  created_at: string;
}

export interface GroupTask {
  task_id: string;
  group_id: string;
  title: string;
  description: string;
  deadline: string;
  status: GroupTaskStatus;
  progress_percentage: number;
  assigned_to: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface GroupSummary {
  group_id: string;
  name: string;
  description: string;
  color: string;
  owner_id: string;
  role: GroupRole;
  joined_at: string;
}

export interface CollaborativeGroup extends Omit<GroupSummary, 'joined_at'> {
  created_at: string;
  updated_at: string;
  members: GroupMember[];
  tasks: GroupTask[];
}
