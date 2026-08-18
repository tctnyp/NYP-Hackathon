-- Sample data for testing Academic Task Manager

-- Sample user (user_id would come from Cognito)
INSERT INTO users (user_id, email, full_name, preferences) VALUES
('sample-user-123', 'student@nyp.edu.sg', 'John Tan', '{"notification_preference": "both", "default_reminder_hours": 24}');

-- Sample modules
INSERT INTO modules (user_id, module_code, module_name, color) VALUES
('sample-user-123', 'IT2166', 'Database Systems', '#3B82F6'),
('sample-user-123', 'IT2164', 'Web Development', '#10B981'),
('sample-user-123', 'IT2165', 'Software Engineering', '#F59E0B'),
('sample-user-123', 'IT2167', 'Mobile Application Development', '#EF4444'),
('sample-user-123', 'IT2168', 'Cloud Computing', '#8B5CF6');

-- Sample tasks with various deadlines and priorities
INSERT INTO tasks (user_id, module_id, title, description, task_type, deadline, estimated_hours, grade_weight, priority, is_group_work, status, progress_percentage) VALUES
-- Urgent tasks
('sample-user-123', 1, 'Database Assignment 2', 'Design and implement a normalized database for an e-commerce system', 'assignment', DATE_ADD(NOW(), INTERVAL 2 DAY), 8, 15, 'high', FALSE, 'in_progress', 40),
('sample-user-123', 2, 'Web Dev Project Submission', 'Complete responsive portfolio website with React', 'project', DATE_ADD(NOW(), INTERVAL 3 DAY), 12, 25, 'urgent', TRUE, 'in_progress', 60),

-- This week
('sample-user-123', 3, 'Software Engineering Test', 'Agile methodologies and UML diagrams', 'test', DATE_ADD(NOW(), INTERVAL 5 DAY), 6, 20, 'medium', FALSE, 'not_started', 0),
('sample-user-123', 4, 'Mobile App Prototype', 'Flutter app prototype with navigation', 'assignment', DATE_ADD(NOW(), INTERVAL 6 DAY), 10, 20, 'high', FALSE, 'in_progress', 25),

-- Next week
('sample-user-123', 5, 'Cloud Computing Lab Report', 'AWS Lambda and API Gateway implementation report', 'report', DATE_ADD(NOW(), INTERVAL 10 DAY), 5, 10, 'medium', FALSE, 'not_started', 0),
('sample-user-123', 1, 'Database Presentation', 'Present database design and implementation', 'presentation', DATE_ADD(NOW(), INTERVAL 12 DAY), 4, 15, 'medium', TRUE, 'not_started', 0),

-- Further out
('sample-user-123', 2, 'Final Web Project', 'Full-stack web application with authentication', 'project', DATE_ADD(NOW(), INTERVAL 21 DAY), 30, 40, 'urgent', TRUE, 'not_started', 0),
('sample-user-123', 3, 'SE Group Project Milestone 2', 'Requirements analysis and system design', 'project', DATE_ADD(NOW(), INTERVAL 18 DAY), 15, 30, 'high', TRUE, 'in_progress', 15),

-- Overdue (for testing)
('sample-user-123', 4, 'Mobile App Tutorial', 'Complete Flutter tutorial exercises', 'assignment', DATE_SUB(NOW(), INTERVAL 1 DAY), 3, 5, 'low', FALSE, 'overdue', 80);

-- Subtasks for a complex project
INSERT INTO subtasks (task_id, title, description, is_completed, order_index) VALUES
(2, 'Set up project repository', 'Initialize Git repo and configure React project', TRUE, 1),
(2, 'Design UI mockups', 'Create Figma mockups for all pages', TRUE, 2),
(2, 'Implement homepage', 'Build responsive homepage component', TRUE, 3),
(2, 'Build portfolio gallery', 'Create image gallery with filtering', FALSE, 4),
(2, 'Add contact form', 'Implement contact form with validation', FALSE, 5),
(2, 'Deploy to hosting', 'Deploy to AWS Amplify', FALSE, 6);

-- Sample reminders
INSERT INTO reminders (task_id, reminder_time, reminder_type, message) VALUES
(1, DATE_ADD(NOW(), INTERVAL 1 DAY), 'both', 'Database Assignment 2 is due in 1 day!'),
(2, DATE_ADD(NOW(), INTERVAL 2 DAY), 'both', 'Web Dev Project due in 2 days - Don\'t forget to deploy!'),
(3, DATE_ADD(NOW(), INTERVAL 4 DAY), 'email', 'Software Engineering Test tomorrow - Review your notes'),
(4, DATE_ADD(NOW(), INTERVAL 3 DAY), 'both', 'Mobile App Prototype due in 3 days');

-- Sample workload snapshot
INSERT INTO workload_snapshots (user_id, week_start_date, total_tasks, total_hours, high_priority_tasks, overdue_tasks) VALUES
('sample-user-123', DATE(NOW() - INTERVAL WEEKDAY(NOW()) DAY), 9, 93, 4, 1);
