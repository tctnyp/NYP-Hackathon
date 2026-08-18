const PRIORITY_LEVELS = Object.freeze(['urgent', 'important', 'high', 'medium', 'low']);

const LEGACY_DIFFICULTY_PRIORITY = Object.freeze({
  easy: 'low',
  medium: 'medium',
  hard: 'high',
  very_hard: 'urgent',
});

const PRIORITY_MULTIPLIERS = Object.freeze({
  urgent: 3,
  important: 2.5,
  high: 2,
  medium: 1.5,
  low: 1,
});

function requestedPriority(body = {}) {
  if (body.priority !== undefined) {
    return PRIORITY_LEVELS.includes(body.priority) ? body.priority : null;
  }
  if (body.difficulty !== undefined) {
    return LEGACY_DIFFICULTY_PRIORITY[body.difficulty] || null;
  }
  return 'medium';
}

function taskPriority(task = {}) {
  if (PRIORITY_LEVELS.includes(task.priority)) return task.priority;
  return LEGACY_DIFFICULTY_PRIORITY[task.difficulty] || 'medium';
}

function withNormalizedPriority(task = {}) {
  const { difficulty: _legacyDifficulty, ...normalizedTask } = task;
  return { ...normalizedTask, priority: taskPriority(task) };
}

function calculatePriorityScore(task, now = new Date()) {
  const deadline = new Date(task.deadline);
  const daysUntilDeadline = (deadline - now) / (1000 * 60 * 60 * 24);

  let urgencyScore = 0;
  if (daysUntilDeadline <= 0) {
    urgencyScore = 100;
  } else if (daysUntilDeadline <= 1) {
    urgencyScore = 50;
  } else if (daysUntilDeadline <= 3) {
    urgencyScore = 30;
  } else if (daysUntilDeadline <= 7) {
    urgencyScore = 15;
  } else {
    urgencyScore = 10 / daysUntilDeadline;
  }

  const importanceScore = (task.grade_weight || 10) / 2;
  const effortScore = (task.estimated_hours || 5) * 0.5;
  const priorityMultiplier = PRIORITY_MULTIPLIERS[taskPriority(task)];

  return (urgencyScore * 0.5 + importanceScore * 0.3 + effortScore * 0.2) * priorityMultiplier;
}

module.exports = {
  PRIORITY_LEVELS,
  calculatePriorityScore,
  requestedPriority,
  taskPriority,
  withNormalizedPriority,
};
