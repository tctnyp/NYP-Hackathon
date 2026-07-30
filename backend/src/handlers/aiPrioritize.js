const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { queryItems, putItem, TASKS_TABLE, generateId, timestamp } = require('../utils/database');
const { success, error, getUserId } = require('../utils/response');

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || 'us-east-1',
});

/**
 * POST /ai/prioritize
 * Get AI-powered task prioritization recommendations
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return error('Unauthorized', 401);
    }

    // Fetch all active tasks
    const allTasks = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'TASK#',
      },
    });

    // Filter out completed tasks
    const tasks = allTasks.filter(t => t.status !== 'completed');

    if (tasks.length === 0) {
      return success({
        message: 'No active tasks to prioritize',
        recommendations: [],
      });
    }

    // Check for cached recommendations (valid for 1 hour)
    const cachedRecs = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'AI#priority#',
      },
    });

    const cached = cachedRecs
      .filter(rec => new Date(rec.expires_at) > new Date())
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

    if (cached) {
      return success({
        recommendations: cached.content,
        cached: true,
        generated_at: cached.created_at,
      });
    }

    // Prepare task summary for AI
    const taskSummary = tasks.map(t => {
      const deadline = new Date(t.deadline);
      const now = new Date();
      const daysLeft = (deadline - now) / (1000 * 60 * 60 * 24);
      
      return {
        id: t.task_id,
        title: t.title,
        module: t.module_id || 'No module',
        type: t.task_type,
        deadline: t.deadline,
        days_left: Math.round(daysLeft * 10) / 10,
        estimated_hours: t.estimated_hours || 'unknown',
        grade_weight: t.grade_weight ? `${t.grade_weight}%` : 'unknown',
        difficulty: t.difficulty,
        is_group: t.is_group_work,
        progress: `${t.progress_percentage}%`,
      };
    });

    // Call Amazon Bedrock for prioritization
    const prompt = `You are an academic advisor helping a polytechnic student prioritize their tasks.

Current Tasks:
${JSON.stringify(taskSummary, null, 2)}

Please analyze these tasks and provide:
1. Top 3 priority tasks they should work on today/this week
2. Brief explanation for each priority (consider deadline urgency, grade weight, estimated effort, and progress)
3. Any warnings about deadline clashes or overwhelming periods
4. A suggested daily focus plan for the next 3 days

Respond in JSON format:
{
  "top_priorities": [
    {"task_id": number, "reason": "string", "suggested_action": "string"}
  ],
  "warnings": ["string"],
  "daily_plan": {
    "today": "string",
    "tomorrow": "string",
    "day_after": "string"
  },
  "workload_assessment": "string"
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
    
    // Parse AI response
    const aiText = responseBody.content[0].text;
    let aiRecommendations;
    
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      aiRecommendations = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      aiRecommendations = {
        top_priorities: [],
        warnings: ['AI response parsing failed'],
        daily_plan: {},
        workload_assessment: aiText,
      };
    }

    // Cache the recommendations (expires in 1 hour)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
    
    await putItem(TASKS_TABLE, {
      PK: `USER#${userId}`,
      SK: `AI#priority#${now.toISOString()}`,
      entity_type: 'AI_RECOMMENDATION',
      recommendation_id: generateId(),
      user_id: userId,
      recommendation_type: 'priority',
      content: aiRecommendations,
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
      ttl: Math.floor(expiresAt.getTime() / 1000),
    });

    return success({
      recommendations: aiRecommendations,
      cached: false,
      task_count: tasks.length,
    });
  } catch (err) {
    console.error('Error generating prioritization:', err);
    return error('Failed to generate prioritization', 500, err.message);
  }
};
