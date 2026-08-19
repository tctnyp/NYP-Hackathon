const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const {
  getItem,
  putItem,
  scanPage,
  updateItem,
  TASKS_TABLE,
  USERS_TABLE,
  timestamp,
} = require('../utils/database');

const sesClient = new SESv2Client({ region: process.env.REGION || process.env.AWS_REGION });
const MAX_ITEMS = 100;
const MAX_ERRORS = 20;
const CURSOR_PK = 'SYSTEM#REMINDER_CHECKER';
const CURSORS = Object.freeze({
  reminders: Object.freeze({ PK: CURSOR_PK, SK: 'CURSOR#DUE_REMINDERS', phase: 'due_reminders' }),
  overdueTasks: Object.freeze({ PK: CURSOR_PK, SK: 'CURSOR#OVERDUE_TASKS', phase: 'overdue_tasks' }),
});

class CursorPersistenceError extends Error {
  constructor() {
    super('Reminder scan cursor persistence failed');
    this.name = 'CursorPersistenceError';
  }
}

function scanCursor(record) {
  const cursor = record?.scan_cursor;
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
  if (typeof cursor.PK !== 'string' || !cursor.PK || typeof cursor.SK !== 'string' || !cursor.SK) return undefined;
  return { PK: cursor.PK, SK: cursor.SK };
}

function pageKey(lastEvaluatedKey) {
  if (!lastEvaluatedKey || typeof lastEvaluatedKey !== 'object') return null;
  if (typeof lastEvaluatedKey.PK !== 'string' || !lastEvaluatedKey.PK
    || typeof lastEvaluatedKey.SK !== 'string' || !lastEvaluatedKey.SK) return null;
  return { PK: lastEvaluatedKey.PK, SK: lastEvaluatedKey.SK };
}

async function persistCursor(definition, lastEvaluatedKey) {
  try {
    await putItem(TASKS_TABLE, {
      PK: definition.PK,
      SK: definition.SK,
      entity_type: 'SYSTEM',
      cursor_phase: definition.phase,
      scan_cursor: pageKey(lastEvaluatedKey),
    });
  } catch {
    throw new CursorPersistenceError();
  }
}

async function markTerminalSkip(reminder, reason) {
  await updateItem(
    TASKS_TABLE,
    { PK: reminder.PK, SK: reminder.SK },
    {
      is_sent: true,
      processed_at: timestamp(),
      delivery_status: 'skipped',
      skip_reason: reason,
    },
  );
}

function safeErrorCode(err) {
  const name = typeof err?.name === 'string' ? err.name : '';
  const allowed = new Set([
    'AccountSuspendedException',
    'AccessDeniedException',
    'BadRequestException',
    'LimitExceededException',
    'MailFromDomainNotVerifiedException',
    'MessageRejected',
    'SendingPausedException',
    'ThrottlingException',
    'TooManyRequestsException',
  ]);
  return allowed.has(name) ? name.slice(0, 64) : 'DeliveryFailed';
}

function addError(results, reminder, err) {
  if (results.errors.length >= MAX_ERRORS) return;
  results.errors.push({
    reminder_id: String(reminder?.reminder_id || 'unknown').replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 80),
    code: safeErrorCode(err),
  });
}

function cleanText(value, fallback, maxLength) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function reminderEmail(task, reminder) {
  const title = cleanText(task.title, 'Academic task', 160);
  const deadline = Number.isNaN(Date.parse(task.deadline))
    ? 'See the application for the current deadline'
    : new Date(task.deadline).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
  const appUrl = String(process.env.APP_URL || '').replace(/\/+$/, '');
  const body = [
    cleanText(reminder.message, `${title} is due soon.`, 500),
    '',
    `Task: ${title}`,
    `Deadline: ${deadline}`,
    appUrl ? `Open Munera: ${appUrl}` : '',
  ].filter(Boolean).join('\n');

  return {
    subject: `Academic task reminder: ${title}`.slice(0, 200),
    body: body.slice(0, 4000),
  };
}

async function sendReminder(destination, task, reminder) {
  const content = reminderEmail(task, reminder);
  return sesClient.send(new SendEmailCommand({
    FromEmailAddress: process.env.REMINDER_FROM_EMAIL,
    Destination: { ToAddresses: [destination] },
    Content: {
      Simple: {
        Subject: { Data: content.subject, Charset: 'UTF-8' },
        Body: { Text: { Data: content.body, Charset: 'UTF-8' } },
      },
    },
  }));
}

exports.handler = async () => {
  const results = { sent: 0, skipped: 0, overdue_updated: 0, failed: 0, errors: [] };

  try {
    if (!process.env.REMINDER_FROM_EMAIL) {
      throw Object.assign(new Error('Reminder sender is not configured'), { name: 'ConfigurationError' });
    }

    const now = new Date();
    const reminderCursorRecord = await getItem(
      TASKS_TABLE,
      { PK: CURSORS.reminders.PK, SK: CURSORS.reminders.SK },
    );
    const reminderStartKey = scanCursor(reminderCursorRecord);
    const reminderPage = await scanPage({
      FilterExpression: 'entity_type = :type AND is_sent = :notSent AND reminder_time <= :now',
      ExpressionAttributeValues: {
        ':type': 'REMINDER',
        ':notSent': false,
        ':now': now.toISOString(),
      },
      Limit: MAX_ITEMS,
      ...(reminderStartKey ? { ExclusiveStartKey: reminderStartKey } : {}),
    });

    for (const reminder of reminderPage.Items.slice(0, MAX_ITEMS)) {
      try {
        const task = await getItem(TASKS_TABLE, {
          PK: `USER#${reminder.user_id}`,
          SK: `TASK#${reminder.task_id}`,
        });
        if (!task) {
          await markTerminalSkip(reminder, 'task_missing');
          results.skipped += 1;
          continue;
        }
        if (task.status === 'completed') {
          await markTerminalSkip(reminder, 'task_completed');
          results.skipped += 1;
          continue;
        }

        const profile = await getItem(USERS_TABLE, { user_id: reminder.user_id });
        const destination = typeof profile?.email === 'string' ? profile.email.trim() : '';
        if (!destination) {
          await markTerminalSkip(reminder, 'recipient_missing');
          results.skipped += 1;
          continue;
        }
        if (destination.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
          await markTerminalSkip(reminder, 'recipient_invalid');
          results.skipped += 1;
          continue;
        }

        await sendReminder(destination, task, reminder);
        await updateItem(
          TASKS_TABLE,
          { PK: reminder.PK, SK: reminder.SK },
          { is_sent: true, sent_at: timestamp() },
        );
        results.sent += 1;
      } catch (err) {
        results.failed += 1;
        addError(results, reminder, err);
      }
    }
    await persistCursor(CURSORS.reminders, reminderPage.LastEvaluatedKey);

    const taskCursorRecord = await getItem(
      TASKS_TABLE,
      { PK: CURSORS.overdueTasks.PK, SK: CURSORS.overdueTasks.SK },
    );
    const taskStartKey = scanCursor(taskCursorRecord);
    const taskPage = await scanPage({
      FilterExpression: 'entity_type = :type AND #status <> :completed AND deadline < :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':type': 'TASK',
        ':completed': 'completed',
        ':now': now.toISOString(),
      },
      Limit: MAX_ITEMS,
      ...(taskStartKey ? { ExclusiveStartKey: taskStartKey } : {}),
    });

    for (const task of taskPage.Items.slice(0, MAX_ITEMS)) {
      if (task.status === 'overdue') continue;
      try {
        await updateItem(
          TASKS_TABLE,
          { PK: task.PK, SK: task.SK },
          { status: 'overdue', GSI3PK: `USER#${task.user_id}#STATUS#overdue`, updated_at: timestamp() },
        );
        results.overdue_updated += 1;
      } catch (err) {
        results.failed += 1;
        addError(results, { reminder_id: task.task_id }, err);
      }
    }
    await persistCursor(CURSORS.overdueTasks, taskPage.LastEvaluatedKey);

    return { statusCode: 200, body: JSON.stringify({ success: true, results }) };
  } catch (err) {
    console.error('Reminder check failed', { code: safeErrorCode(err) });
    if (err instanceof CursorPersistenceError) throw err;
    const invocationError = new Error('Reminder check failed');
    invocationError.name = 'ReminderCheckError';
    throw invocationError;
  }
};

exports._test = { reminderEmail, safeErrorCode, scanCursor, pageKey, CURSORS, MAX_ITEMS };
