const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { getItem, putItem, batchWrite, queryItems, TASKS_TABLE, generateId, timestamp } = require('../utils/database');
const { success, error, getUserId } = require('../utils/response');

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || 'us-east-1',
});

/**
 * POST /ai/breakdown/{taskId}
 * Get AI-powered task breakdown into subtasks
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return error('Unauthorized', 401);
    }

    const taskId = event.pathParameters?.taskId;
    if (!taskId) {
      return error('Missing taskId parameter', 400);
    }

    // Fetch task details
    const task = await getItem(TASKS_TABLE, {
      PK: `USER#${userId}`,
      SK: `TASK#${taskId}`,
    });

    if (!task) {
      return error('Task not found', 404);
    }

    // Check for cached breakdown
    const cachedRecs = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': `AI#breakdown#`,
      },
      FilterExpression: 'task_id = :taskId AND expires_at > :now',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': `AI#breakdown#`,
        ':taskId': taskId,
        ':now': new Date().toISOString(),
      },
    });

    const cached = cachedRecs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

    if (cached) {
      return success({
        subtasks: cached.content,
        cached: true,
        generated_at: cached.created_at,
      });
    }

    // Call Amazon Bedrock for task breakdown
    const prompt = `You are an academic advisor helping a polytechnic student break down a large task into manageable subtasks.

Task Details:
- Title: ${task.title}
- Module: ${task.module_code || 'N/A'} - ${task.module_name || 'N/A'}
- Type: ${task.task_type}
- Deadline: ${task.deadline}
- Description: ${task.description || 'No description provided'}
- Estimated Hours: ${task.estimated_hours || 'Not specified'}
- Difficulty: ${task.difficulty}
- Is Group Work: ${task.is_group_work ? 'Yes' : 'No'}

Please break this task down into 4-8 actionable subtasks. Each subtask should:
1. Be specific and actionable
2. Be completable in 1-3 hours
3. Have a logical sequence (if order matters)
4. Include a brief description

Respond in JSON format:
{
  "subtasks": [
    {
      "title": "string",
      "description": "string",
      "estimated_minutes": number,
      "order": number
    }
  ],
  "tips": ["string"],
  "estimated_total_hours": number
}`;

    const input = {
      modelId: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    };

    const command = new InvokeModelCommand(input);
    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    const aiText = responseBody.content[0].text;
    let breakdown;
    
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      breakdown = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      return error('Failed to parse AI breakdown', 500, parseError.message);
    }

    // Insert subtasks into database
    if (breakdown.subtasks && breakdown.subtasks.length > 0) {
      const now = timestamp();
      const subtaskItems = breakdown.subtasks.map((st, index) => ({
        PutRequest: {
          Item: {
            PK: `USER#${userId}`,
            SK: `TASK#${taskId}#SUBTASK#${generateId()}`,
            entity_type: 'SUBTASK',
            subtask_id: generateId(),
            task_id: taskId,
            user_id: userId,
            title: st.title,
            description: st.description,
            is_completed: false,
            order_index: index + 1,
            created_at: now,
          },
        },
      }));

      await batchWrite(subtaskItems);
    }

    // Cache the breakdown (expires in 24 hours)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    await putItem(TASKS_TABLE, {
      PK: `USER#${userId}`,
      SK: `AI#breakdown#${now.toISOString()}`,
      entity_type: 'AI_RECOMMENDATION',
      recommendation_id: generateId(),
      user_id: userId,
      task_id: taskId,
      recommendation_type: 'breakdown',
      content: breakdown,
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
      ttl: Math.floor(expiresAt.getTime() / 1000),
    });

    return success({
      breakdown,
      subtasks_created: breakdown.subtasks?.length || 0,
      cached: false,
    });
  } catch (err) {
    console.error('Error generating task breakdown:', err);
    return error('Failed to generate task breakdown', 500, err.message);
  }
};
