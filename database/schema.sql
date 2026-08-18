-- Academic Task Manager Database Schema for Amazon Aurora MySQL

-- Users table
CREATE TABLE users (
    user_id VARCHAR(128) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    preferences JSON,
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Modules table
CREATE TABLE modules (
    module_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    module_code VARCHAR(20) NOT NULL,
    module_name VARCHAR(255) NOT NULL,
    color VARCHAR(7) DEFAULT '#3B82F6',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_module (user_id, module_code),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tasks table
CREATE TABLE tasks (
    task_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    module_id INT,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    task_type ENUM('assignment', 'test', 'exam', 'project', 'presentation', 'report', 'competition', 'other') NOT NULL,
    deadline DATETIME NOT NULL,
    estimated_hours DECIMAL(5,2),
    grade_weight DECIMAL(5,2),
    priority ENUM('urgent', 'important', 'high', 'medium', 'low') DEFAULT 'medium',
    is_group_work BOOLEAN DEFAULT FALSE,
    status ENUM('not_started', 'in_progress', 'completed', 'overdue') DEFAULT 'not_started',
    progress_percentage INT DEFAULT 0,
    priority_score DECIMAL(5,2),
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (module_id) REFERENCES modules(module_id) ON DELETE SET NULL,
    INDEX idx_user_deadline (user_id, deadline),
    INDEX idx_user_status (user_id, status),
    INDEX idx_deadline (deadline),
    INDEX idx_priority (priority_score DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Subtasks table (for breaking down large tasks)
CREATE TABLE subtasks (
    subtask_id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_completed BOOLEAN DEFAULT FALSE,
    order_index INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
    INDEX idx_task_id (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reminders table
CREATE TABLE reminders (
    reminder_id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT NOT NULL,
    reminder_time DATETIME NOT NULL,
    reminder_type ENUM('email', 'push', 'both') DEFAULT 'both',
    message TEXT,
    is_sent BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
    INDEX idx_reminder_time (reminder_time),
    INDEX idx_task_id (task_id),
    INDEX idx_pending (is_sent, reminder_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Workload snapshots (for analytics)
CREATE TABLE workload_snapshots (
    snapshot_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    week_start_date DATE NOT NULL,
    total_tasks INT DEFAULT 0,
    total_hours DECIMAL(7,2) DEFAULT 0,
    high_priority_tasks INT DEFAULT 0,
    overdue_tasks INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_week (user_id, week_start_date),
    INDEX idx_user_week (user_id, week_start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stored procedure for calculating priority score
DELIMITER //
CREATE PROCEDURE calculate_priority_score(IN p_task_id INT)
BEGIN
    DECLARE v_days_until_deadline DECIMAL(10,2);
    DECLARE v_urgency_score DECIMAL(5,2);
    DECLARE v_importance_score DECIMAL(5,2);
    DECLARE v_effort_score DECIMAL(5,2);
    DECLARE v_final_score DECIMAL(5,2);
    DECLARE v_priority_multiplier DECIMAL(3,2);
    
    SELECT 
        TIMESTAMPDIFF(HOUR, NOW(), deadline) / 24.0,
        COALESCE(grade_weight, 10),
        COALESCE(estimated_hours, 5),
        CASE priority
            WHEN 'urgent' THEN 3
            WHEN 'important' THEN 2.5
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 1.5
            WHEN 'low' THEN 1
            ELSE 1.5
        END
    INTO v_days_until_deadline, v_importance_score, v_effort_score, v_priority_multiplier
    FROM tasks
    WHERE task_id = p_task_id;
    
    -- Urgency: increases as deadline approaches
    IF v_days_until_deadline <= 0 THEN
        SET v_urgency_score = 100;
    ELSEIF v_days_until_deadline <= 1 THEN
        SET v_urgency_score = 50;
    ELSEIF v_days_until_deadline <= 3 THEN
        SET v_urgency_score = 30;
    ELSEIF v_days_until_deadline <= 7 THEN
        SET v_urgency_score = 15;
    ELSE
        SET v_urgency_score = 10 / v_days_until_deadline;
    END IF;
    
    -- Importance: based on grade weight
    SET v_importance_score = v_importance_score / 2;
    
    -- Effort consideration
    SET v_effort_score = v_effort_score * 0.5;
    
    -- Final weighted score
    SET v_final_score = ((v_urgency_score * 0.5) + (v_importance_score * 0.3) + (v_effort_score * 0.2)) * v_priority_multiplier;
    
    UPDATE tasks
    SET priority_score = v_final_score
    WHERE task_id = p_task_id;
END //
DELIMITER ;

-- Trigger to update priority score on task changes
DELIMITER //
CREATE TRIGGER update_priority_after_insert
AFTER INSERT ON tasks
FOR EACH ROW
BEGIN
    CALL calculate_priority_score(NEW.task_id);
END //

CREATE TRIGGER update_priority_after_update
AFTER UPDATE ON tasks
FOR EACH ROW
BEGIN
    CALL calculate_priority_score(NEW.task_id);
END //
DELIMITER ;

-- View for upcoming deadlines
CREATE VIEW upcoming_deadlines AS
SELECT 
    t.task_id,
    t.user_id,
    t.title,
    t.deadline,
    t.task_type,
    t.status,
    t.priority_score,
    m.module_code,
    m.module_name,
    TIMESTAMPDIFF(HOUR, NOW(), t.deadline) / 24.0 AS days_until_deadline,
    CASE
        WHEN t.deadline < NOW() THEN 'overdue'
        WHEN TIMESTAMPDIFF(HOUR, NOW(), t.deadline) <= 24 THEN 'critical'
        WHEN TIMESTAMPDIFF(HOUR, NOW(), t.deadline) <= 72 THEN 'urgent'
        WHEN TIMESTAMPDIFF(HOUR, NOW(), t.deadline) <= 168 THEN 'upcoming'
        ELSE 'future'
    END AS urgency_level
FROM tasks t
LEFT JOIN modules m ON t.module_id = m.module_id
WHERE t.status != 'completed'
ORDER BY t.deadline ASC;
