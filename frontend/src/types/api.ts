// Task Types
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue';
export type TaskType = 'assignment' | 'test' | 'exam' | 'project' | 'presentation' | 'report' | 'competition' | 'other';
export type TaskDifficulty = 'easy' | 'medium' | 'hard' | 'very_hard';

export interface Task {
  task_id: string;
  user_id: string;
  module_id?: string;
  title: string;
  description?: string;
  task_type: TaskType;
  deadline: string;
  estimated_hours?: number;
  grade_weight?: number;
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
  overdue_tasks: number;
  completion_rate: number;
}

export interface DashboardData {
  statistics: DashboardStatistics;
  upcoming_tasks: Task[];
  tasks_by_module: Module[];
  high_priority_tasks: Task[];
}

export interface AIPriority {
  task_id: number;
  reason: string;
  suggested_action: string;
}

export interface AIRecommendations {
  top_priorities: AIPriority[];
  warnings: string[];
  workload_assessment: string;
}
