const {
  CORS_HEADERS,
  getUserId,
  getUserEmail,
  getUsername,
  getUserName,
  getGroups,
  isAdmin,
} = require('../src/utils/response');

describe('Cognito response helpers', () => {
  const restEvent = {
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          email: 'student@example.com',
          name: 'Student Name',
          'cognito:username': 'student',
          'cognito:groups': '[Admins, Students]',
        },
      },
    },
  };

  test('extracts identity claims from a REST API authorizer', () => {
    expect(getUserId(restEvent)).toBe('user-123');
    expect(getUserEmail(restEvent)).toBe('student@example.com');
    expect(getUsername(restEvent)).toBe('student');
    expect(getUserName(restEvent)).toBe('Student Name');
  });

  test('recognizes Admins membership in Cognito group strings', () => {
    expect(getGroups(restEvent)).toEqual(['Admins', 'Students']);
    expect(isAdmin(restEvent)).toBe(true);
  });

  test('supports HTTP API JWT claims and array groups', () => {
    const event = {
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              sub: 'user-456',
              given_name: 'Another',
              family_name: 'Student',
              'cognito:groups': ['Students'],
            },
          },
        },
      },
    };

    expect(getUserId(event)).toBe('user-456');
    expect(getUserName(event)).toBe('Another Student');
    expect(getGroups(event)).toEqual(['Students']);
    expect(isAdmin(event)).toBe(false);
  });

  test('does not fall back to a demo user when claims are absent', () => {
    process.env.DEFAULT_USER_ID = 'demo-user';
    expect(getUserId({})).toBeNull();
    delete process.env.DEFAULT_USER_ID;
  });

  test('allows authenticated PATCH requests without an API key header', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Methods']).toContain('PATCH');
    expect(CORS_HEADERS['Access-Control-Allow-Headers']).toBe('Content-Type,Authorization');
  });
});
