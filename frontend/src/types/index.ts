// Task Types
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue';
export type TaskType = 'assignment' | 'test' | 'exam' | 'project' | 'presentation' | 'report' | 'competition' | 'other';
export type TaskPriority = 'urgent' | 'important' | 'high' | 'medium' | 'low';
export type UrgencyLevel = 'overdue' | 'critical' | 'urgent' | 'upcoming' | 'future';

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
  priority: TaskPriority;
  is_group_work: boolean;
  status: TaskStatus;
  progress_percentage: number;
  priority_score: number;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  module_code?: string;
  module_name?: string;
  module_color?: string;
  days_until_deadline?: number;
  urgency_level?: UrgencyLevel;
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
