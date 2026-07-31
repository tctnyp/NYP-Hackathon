const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const { queryItems, TASKS_TABLE } = require('../utils/database');
const { success, error, getUserId, parseBody } = require('../utils/response');

const agentClient = new BedrockAgentRuntimeClient({
  region: process.env.BEDROCK_REGION || 'us-east-1',
});

/**
 * POST /ai/agent
 * Use Amazon Bedrock Agent for natural language task queries
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return error('Unauthorized', 401);
    }

    const body = parseBody(event);
    if (!body || !body.query) {
      return error('Missing query parameter', 400);
    }

    const { query: userQuery } = body;

    // Get user's tasks for context
    const tasks = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'TASK#',
      },
    });

    // Prepare context
    const taskContext = tasks
      .filter(t => t.status !== 'completed')
      .map(t => ({
        id: t.task_id,
        title: t.title,
        type: t.task_type,
        deadline: t.deadline,
        status: t.status,
        priority: t.priority_score,
      }));

    // Call Bedrock Agent
    const command = new InvokeAgentCommand({
      agentId: process.env.BEDROCK_AGENT_ID || 'TESTAGENT',
      agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID',
      sessionId: `session-${userId}-${Date.now()}`,
      inputText: `Context: User has ${tasks.length} tasks. Active: ${JSON.stringify(taskContext)}\n\nQuery: ${userQuery}`,
    });

    const response = await agentClient.send(command);

    // Extract response
    let agentResponse = '';
    if (response.completion) {
      for await (const chunk of response.completion) {
        if (chunk.chunk && chunk.chunk.bytes) {
          agentResponse += new TextDecoder().decode(chunk.chunk.bytes);
        }
      }
    }

    return success({
      query: userQuery,
      response: agentResponse,
      context_tasks: taskContext.length,
    });
  } catch (err) {
    console.error('Error invoking Bedrock Agent:', err);
    return error('Failed to invoke AI agent', 500, err.message);
  }
};
