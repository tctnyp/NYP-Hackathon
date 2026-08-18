// Task Types
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue';
export type TaskType = 'assignment' | 'test' | 'exam' | 'project' | 'presentation' | 'report' | 'competition' | 'other';
export type TaskPriority = 'urgent' | 'important' | 'high' | 'medium' | 'low';

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
  priority: TaskPriority;
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
