const {
  PRIORITY_LEVELS,
  calculatePriorityScore,
  requestedPriority,
  taskPriority,
  withNormalizedPriority,
} = require('../src/utils/taskPriority');

describe('task priority contract', () => {
  test('defines the five product priority levels in display order', () => {
    expect(PRIORITY_LEVELS).toEqual(['urgent', 'important', 'high', 'medium', 'low']);
  });

  test.each(PRIORITY_LEVELS)('accepts canonical priority %s', (priority) => {
    expect(requestedPriority({ priority })).toBe(priority);
  });

  test('rejects unknown priority values', () => {
    expect(requestedPriority({ priority: 'critical' })).toBeNull();
  });

  test.each([
    ['easy', 'low'],
    ['medium', 'medium'],
    ['hard', 'high'],
    ['very_hard', 'urgent'],
  ])('maps legacy difficulty %s to %s', (difficulty, priority) => {
    expect(requestedPriority({ difficulty })).toBe(priority);
    expect(taskPriority({ difficulty })).toBe(priority);
  });

  test('normalizes legacy records without returning the difficulty field', () => {
    expect(withNormalizedPriority({ task_id: 'task-1', difficulty: 'hard' })).toEqual({
      task_id: 'task-1',
      priority: 'high',
    });
  });

  test('orders otherwise identical tasks by the five priority levels', () => {
    const baseTask = {
      deadline: '2026-09-01T00:00:00.000Z',
      grade_weight: 20,
      estimated_hours: 4,
    };
    const now = new Date('2026-08-20T00:00:00.000Z');
    const scores = PRIORITY_LEVELS.map((priority) => calculatePriorityScore({ ...baseTask, priority }, now));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(scores).size).toBe(PRIORITY_LEVELS.length);
  });
});
