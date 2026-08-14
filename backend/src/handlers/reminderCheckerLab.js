const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { getItem, scanItems, updateItem, TASKS_TABLE, USERS_TABLE, timestamp } = require('../utils/database');

const snsClient = new SNSClient({ region: process.env.REGION || process.env.AWS_REGION });

exports.handler = async () => {
  const results = { sent: 0, skipped: 0, overdue_updated: 0, failed: 0, errors: [] };

  try {
    const now = new Date();
    const reminders = await scanItems({
      FilterExpression: 'entity_type = :type AND is_sent = :notSent AND reminder_time <= :now',
      ExpressionAttributeValues: {
        ':type': 'REMINDER',
        ':notSent': false,
        ':now': now.toISOString(),
      },
    });

    for (const reminder of reminders.slice(0, 100)) {
      try {
        const task = await getItem(TASKS_TABLE, {
          PK: `USER#${reminder.user_id}`,
          SK: `TASK#${reminder.task_id}`,
        });
        if (!task || task.status === 'completed') {
          results.skipped += 1;
          continue;
        }

        const profile = await getItem(USERS_TABLE, { user_id: reminder.user_id });
        const destination = profile?.email || process.env.DEFAULT_USER_EMAIL;
        const message = [
          reminder.message || `${task.title} is due soon.`,
          `Task: ${task.title}`,
          `Deadline: ${new Date(task.deadline).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}`,
          `User: ${destination}`,
        ].join('\n');

        await snsClient.send(new PublishCommand({
          TopicArn: process.env.SNS_TOPIC_ARN,
          Subject: `Academic task reminder: ${task.title}`.slice(0, 100),
          Message: message,
          MessageAttributes: {
            user_id: { DataType: 'String', StringValue: reminder.user_id },
            task_id: { DataType: 'String', StringValue: String(reminder.task_id) },
          },
        }));

        await updateItem(TASKS_TABLE, { PK: reminder.PK, SK: reminder.SK }, { is_sent: true, sent_at: timestamp() });
        results.sent += 1;
      } catch (err) {
        results.failed += 1;
        results.errors.push({ reminder_id: reminder.reminder_id, error: err.message });
      }
    }

    const tasks = await scanItems({
      FilterExpression: 'entity_type = :type AND #status <> :completed AND deadline < :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':type': 'TASK',
        ':completed': 'completed',
        ':now': now.toISOString(),
      },
    });

    for (const task of tasks.slice(0, 100)) {
      if (task.status !== 'overdue') {
        await updateItem(
          TASKS_TABLE,
          { PK: task.PK, SK: task.SK },
          { status: 'overdue', GSI3PK: `USER#${task.user_id}#STATUS#overdue`, updated_at: timestamp() },
        );
        results.overdue_updated += 1;
      }
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, results }) };
  } catch (err) {
    console.error('DynamoDB reminder check failed:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message, results }) };
  }
};
