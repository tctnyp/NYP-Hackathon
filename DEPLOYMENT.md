# Deployment Guide - Academic Task Manager

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI installed and configured
- AWS SAM CLI installed
- Node.js 18.x or higher

## Backend Deployment

```bash
cd backend
npm install
sam build
sam deploy --guided
```

Save the outputs:
- ApiUrl
- UserPoolId
- UserPoolClientId

## Frontend Configuration

```bash
cd frontend
cp .env.example .env
```

Edit `.env` with your backend outputs.

## Deploy to Amplify

1. Go to AWS Amplify Console
2. Connect your Git repository
3. Configure build settings for the frontend folder
4. Add environment variables
5. Deploy!

## Test the Application

Visit your Amplify URL and sign up with email/password.

For detailed instructions, see README.md
