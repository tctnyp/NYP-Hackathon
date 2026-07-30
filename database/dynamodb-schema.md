# DynamoDB Schema Design for Academic Task Manager

## Table Structure

### 1. Users Table
**Table Name:** `academic-task-users`

```
Primary Key:
- PK: user_id (String) - Cognito user sub

Attributes:
- email (String)
- full_name (String)
- created_at (String - ISO 8601)
- updated_at (String - ISO 8601)
- preferences (Map)
  - notification_preference (String)
  - default_reminder_hours (Number)
```

### 2. Tasks Table (Main Table)
**Table Name:** `academic-tasks`

```
Primary Key:
- PK: USER#<user_id> (String)
- SK: TASK#<task_id> (String)

GSI1 - TasksByDeadline:
- GSI1PK: USER#<user_id>
- GSI1SK: DEADLINE#<iso_date>#TASK#<task_id>

GSI2 - TasksByModule:
- GSI2PK: USER#<user_id>#MODULE#<module_id>
- GSI2SK: TASK#<task_id>

GSI3 - TasksByStatus:
- GSI3PK: USER#<user_id>#STATUS#<status>
- GSI3SK: PRIORITY#<priority_score>#TASK#<task_id>

Attributes:
- task_id (String - UUID)
- user_id (String)
- module_id (String - optional)
- title (String)
- description (String)
- task_type (String) - assignment|test|exam|project|presentation|report|competition|other
- deadline (String - ISO 8601)
- estimated_hours (Number)
- grade_weight (Number)
- difficulty (String) - easy|medium|hard|very_hard
- is_group_work (Boolean)
- status (String) - not_started|in_progress|completed|overdue
- progress_percentage (Number)
- priority_score (Number)
- completed_at (String - ISO 8601)
- created_at (String - ISO 8601)
- updated_at (String - ISO 8601)
- entity_type: "TASK"
```

### 3. Modules (in Tasks Table)
**Table Name:** `academic-tasks`

```
Primary Key:
- PK: USER#<user_id>
- SK: MODULE#<module_id>

Attributes:
- module_id (String - UUID)
- user_id (String)
- module_code (String)
- module_name (String)
- color (String)
- created_at (String - ISO 8601)
- entity_type: "MODULE"
```

### 4. Subtasks (in Tasks Table)
**Table Name:** `academic-tasks`

```
Primary Key:
- PK: USER#<user_id>
- SK: TASK#<task_id>#SUBTASK#<subtask_id>

Attributes:
- subtask_id (String - UUID)
- task_id (String)
- user_id (String)
- title (String)
- description (String)
- is_completed (Boolean)
- order_index (Number)
- created_at (String - ISO 8601)
- completed_at (String - ISO 8601)
- entity_type: "SUBTASK"
```

### 5. Reminders (in Tasks Table)
**Table Name:** `academic-tasks`

```
Primary Key:
- PK: REMINDER#<iso_date_hour>
- SK: TASK#<task_id>#<reminder_id>

GSI4 - RemindersByTask:
- GSI4PK: TASK#<task_id>
- GSI4SK: REMINDER#<reminder_id>

Attributes:
- reminder_id (String - UUID)
- task_id (String)
- user_id (String)
- reminder_time (String - ISO 8601)
- reminder_type (String) - email|push|both
- message (String)
- is_sent (Boolean)
- sent_at (String - ISO 8601)
- created_at (String - ISO 8601)
- entity_type: "REMINDER"
```

### 6. AI Recommendations (in Tasks Table)
**Table Name:** `academic-tasks`

```
Primary Key:
- PK: USER#<user_id>
- SK: AI#<recommendation_type>#<timestamp>

Attributes:
- recommendation_id (String - UUID)
- user_id (String)
- recommendation_type (String) - priority|breakdown|workload|study_plan
- task_id (String - optional)
- content (Map)
- expires_at (String - ISO 8601)
- created_at (String - ISO 8601)
- entity_type: "AI_RECOMMENDATION"

TTL Attribute: ttl (Number - Unix timestamp for expires_at)
```

## Access Patterns

1. **Get user profile** → Query PK=user_id on Users table
2. **Get all tasks for user** → Query PK=USER#<user_id> where SK begins_with "TASK#"
3. **Get tasks by deadline** → Query GSI1 where GSI1PK=USER#<user_id>
4. **Get tasks by module** → Query GSI2 where GSI2PK=USER#<user_id>#MODULE#<module_id>
5. **Get tasks by status** → Query GSI3 where GSI3PK=USER#<user_id>#STATUS#<status>
6. **Get high priority tasks** → Query GSI3 with filter on priority_score
7. **Get pending reminders** → Query PK range on current hour buckets
8. **Get subtasks for task** → Query PK=USER#<user_id> where SK begins_with "TASK#<task_id>#SUBTASK#"
9. **Get modules for user** → Query PK=USER#<user_id> where SK begins_with "MODULE#"
10. **Get AI recommendations** → Query PK=USER#<user_id> where SK begins_with "AI#<type>#"

## Indexes Summary

- **Main Table:** PK + SK
- **GSI1 (TasksByDeadline):** Enables sorting tasks by deadline
- **GSI2 (TasksByModule):** Enables filtering by module
- **GSI3 (TasksByStatus):** Enables filtering by status and priority
- **GSI4 (RemindersByTask):** Enables querying reminders for a task
- **TTL:** Automatic cleanup of expired AI recommendations
