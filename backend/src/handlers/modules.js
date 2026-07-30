const { getItem, putItem, updateItem, deleteItem, queryItems, TASKS_TABLE, generateId, timestamp } = require('../utils/database');
const { success, error, getUserId, parseBody, validateRequired } = require('../utils/response');

/**
 * GET /modules
 * Get all modules for the user
 */
exports.getModules = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return error('Unauthorized', 401);
    }

    const modules = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'MODULE#',
      },
    });

    // Get task counts for each module
    const modulesWithCounts = await Promise.all(
      modules.map(async (module) => {
        const tasks = await queryItems({
          IndexName: 'GSI2-TasksByModule',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: {
            ':pk': `USER#${userId}#MODULE#${module.module_id}`,
          },
        });

        const activeTasks = tasks.filter(t => t.status !== 'completed').length;

        return {
          ...module,
          task_count: tasks.length,
          active_task_count: activeTasks,
        };
      })
    );

    return success({ modules: modulesWithCounts });
  } catch (err) {
    console.error('Error fetching modules:', err);
    return error('Failed to fetch modules', 500, err.message);
  }
};

/**
 * POST /modules
 * Create a new module
 */
exports.createModule = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return error('Unauthorized', 401);
    }

    const body = parseBody(event);
    if (!body) {
      return error('Invalid JSON body', 400);
    }

    const required = validateRequired(body, ['module_code', 'module_name']);
    if (required) {
      return error(`Missing required fields: ${required.join(', ')}`, 400);
    }

    const { module_code, module_name, color = '#3B82F6' } = body;
    const moduleId = generateId();
    const now = timestamp();

    // Check for duplicate module code
    const existingModules = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'MODULE#',
      },
      FilterExpression: 'module_code = :code',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'MODULE#',
        ':code': module_code,
      },
    });

    if (existingModules.length > 0) {
      return error('Module code already exists', 409);
    }

    const module = {
      PK: `USER#${userId}`,
      SK: `MODULE#${moduleId}`,
      entity_type: 'MODULE',
      module_id: moduleId,
      user_id: userId,
      module_code,
      module_name,
      color,
      created_at: now,
    };

    await putItem(TASKS_TABLE, module);

    return success({ module }, 201);
  } catch (err) {
    console.error('Error creating module:', err);
    return error('Failed to create module', 500, err.message);
  }
};

/**
 * PUT /modules/{moduleId}
 * Update a module
 */
exports.updateModule = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return error('Unauthorized', 401);
    }

    const moduleId = event.pathParameters?.moduleId;
    if (!moduleId) {
      return error('Missing moduleId parameter', 400);
    }

    const body = parseBody(event);
    if (!body) {
      return error('Invalid JSON body', 400);
    }

    // Verify module belongs to user
    const existingModule = await getItem(TASKS_TABLE, {
      PK: `USER#${userId}`,
      SK: `MODULE#${moduleId}`,
    });

    if (!existingModule) {
      return error('Module not found', 404);
    }

    const updates = {};

    if (body.module_code) updates.module_code = body.module_code;
    if (body.module_name) updates.module_name = body.module_name;
    if (body.color) updates.color = body.color;

    if (Object.keys(updates).length === 0) {
      return error('No fields to update', 400);
    }

    const updatedModule = await updateItem(
      TASKS_TABLE,
      { PK: `USER#${userId}`, SK: `MODULE#${moduleId}` },
      updates
    );

    return success({ module: updatedModule });
  } catch (err) {
    console.error('Error updating module:', err);
    return error('Failed to update module', 500, err.message);
  }
};

/**
 * DELETE /modules/{moduleId}
 * Delete a module
 */
exports.deleteModule = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return error('Unauthorized', 401);
    }

    const moduleId = event.pathParameters?.moduleId;
    if (!moduleId) {
      return error('Missing moduleId parameter', 400);
    }

    // Verify module belongs to user
    const existingModule = await getItem(TASKS_TABLE, {
      PK: `USER#${userId}`,
      SK: `MODULE#${moduleId}`,
    });

    if (!existingModule) {
      return error('Module not found', 404);
    }

    // Delete module
    await deleteItem(TASKS_TABLE, {
      PK: `USER#${userId}`,
      SK: `MODULE#${moduleId}`,
    });

    // Note: Tasks with this module_id will still exist but with orphaned module_id
    // In production, you might want to either:
    // 1. Prevent deletion if tasks exist
    // 2. Update all tasks to set module_id = null
    // 3. Delete all tasks with this module

    return success({ message: 'Module deleted successfully' });
  } catch (err) {
    console.error('Error deleting module:', err);
    return error('Failed to delete module', 500, err.message);
  }
};
