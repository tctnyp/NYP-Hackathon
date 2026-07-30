const awsExports = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || 'ap-southeast-1_xxxxxxxxx',
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || 'your-client-id',
      region: import.meta.env.VITE_COGNITO_REGION || 'ap-southeast-1',
      signUpVerificationMethod: 'code',
      loginWith: {
        email: true,
      },
    },
  },
};

export default awsExports;
