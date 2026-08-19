const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { scanItems, updateItem, putItem, TASKS_TABLE, timestamp } = require('../utils/database');

const snsClient = new SNSClient({ region: process.env.AWS_REGION });

/**
 * EventBridge scheduled function to check and send reminders
 * Runs every 15 minutes
 */
exports.handler = async (event) => {
  try {
    console.log('Starting reminder check...');

    // Fetch pending reminders that are due
    const pendingReminders = await query(
      `SELECT 
        r.reminder_id,
        r.task_id,
        r.message,
        r.reminder_type,
        t.title AS task_title,
        t.deadline,
        t.task_type,
        u.user_id,
        u.email,
        u.full_name,
        m.module_code
       FROM reminders r
       INNER JOIN tasks t ON r.task_id = t.task_id
       INNER JOIN users u ON t.user_id = u.user_id
       LEFT JOIN modules m ON t.module_id = m.module_id
       WHERE r.is_sent = FALSE 
       AND r.reminder_time <= NOW()
       AND t.status != 'completed'
       ORDER BY r.reminder_time ASC
       LIMIT 100`,
      []
    );

    console.log(`Found ${pendingReminders.length} reminders to send`);

    const results = {
      sent: 0,
      failed: 0,
      errors: [],
    };

    for (const reminder of pendingReminders) {
      try {
        const message = formatReminderMessage(reminder);
        
        // Send notification via SNS
        if (reminder.reminder_type === 'email' || reminder.reminder_type === 'both') {
          await sendEmailNotification(reminder.email, message, reminder);
        }

        // Mark reminder as sent
        await query(
          'UPDATE reminders SET is_sent = TRUE, sent_at = NOW() WHERE reminder_id = ?',
          [reminder.reminder_id]
        );

        results.sent++;
        console.log(`Sent reminder ${reminder.reminder_id} to ${reminder.email}`);
      } catch (err) {
        results.failed++;
        results.errors.push({
          reminder_id: reminder.reminder_id,
          error: err.message,
        });
        console.error(`Failed to send reminder ${reminder.reminder_id}:`, err);
      }
    }

    // Check for overdue tasks and create urgent reminders
    const overdueTasks = await query(
      `SELECT t.task_id, t.title, t.user_id, u.email
       FROM tasks t
       INNER JOIN users u ON t.user_id = u.user_id
       WHERE t.status != 'completed' 
       AND t.deadline < NOW()
       AND NOT EXISTS (
         SELECT 1 FROM reminders r 
         WHERE r.task_id = t.task_id 
         AND r.message LIKE '%overdue%'
       )
       LIMIT 50`,
      []
    );

    if (overdueTasks.length > 0) {
      console.log(`Found ${overdueTasks.length} overdue tasks without reminders`);
      
      for (const task of overdueTasks) {
        await query(
          `INSERT INTO reminders (task_id, reminder_time, reminder_type, message, is_sent)
           VALUES (?, NOW(), 'email', ?, TRUE)`,
          [task.task_id, `URGENT: ${task.title} is now overdue!`]
        );
      }
    }

    console.log('Reminder check completed:', results);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        results,
        overdue_tasks_found: overdueTasks.length,
      }),
    };
  } catch (err) {
    console.error('Error in reminder handler:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: err.message,
      }),
    };
  }
};

/**
 * Format reminder message
 */
function formatReminderMessage(reminder) {
  const deadlineDate = new Date(reminder.deadline);
  const now = new Date();
  const hoursLeft = Math.round((deadlineDate - now) / (1000 * 60 * 60));
  
  let urgencyText = '';
  if (hoursLeft < 0) {
    urgencyText = '⚠️ OVERDUE';
  } else if (hoursLeft < 24) {
    urgencyText = `🔴 ${hoursLeft} hours left`;
  } else if (hoursLeft < 72) {
    urgencyText = `🟡 ${Math.round(hoursLeft / 24)} days left`;
  } else {
    urgencyText = `🟢 ${Math.round(hoursLeft / 24)} days left`;
  }

  return {
    subject: `Reminder: ${reminder.task_title}`,
    body: reminder.message || `Your ${reminder.task_type} "${reminder.task_title}" is due soon!`,
    urgency: urgencyText,
    deadline: deadlineDate.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }),
    module: reminder.module_code || 'No module',
  };
}

/**
 * Send email notification via SNS
 */
async function sendEmailNotification(email, message, reminder) {
  const emailBody = `
Hello ${reminder.full_name},

${message.body}

Task Details:
- Task: ${reminder.task_title}
- Module: ${message.module}
- Type: ${reminder.task_type}
- Deadline: ${message.deadline}
- Status: ${message.urgency}

Don't forget to complete your task on time!

Best regards,
Munera
  `.trim();

  const params = {
    TopicArn: process.env.SNS_TOPIC_ARN,
    Subject: message.subject,
    Message: emailBody,
    MessageAttributes: {
      email: {
        DataType: 'String',
        StringValue: email,
      },
      task_id: {
        DataType: 'Number',
        StringValue: String(reminder.task_id),
      },
    },
  };

  const command = new PublishCommand(params);
  await snsClient.send(command);
}
