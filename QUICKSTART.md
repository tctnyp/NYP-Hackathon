# Quick Start Guide - Academic Task Manager

## 🚀 Get Started in 15 Minutes

### Prerequisites Check
```bash
node --version    # Should be 18.x or higher
aws --version     # AWS CLI installed
sam --version     # AWS SAM CLI installed
```

### Step 1: Clone & Install (2 min)
```bash
cd NYP-Hackathon
npm run install-all
```

### Step 2: Deploy Backend (5 min)
```bash
cd backend
sam build
sam deploy --guided
```

**Save these outputs:**
- ApiUrl
- UserPoolId  
- UserPoolClientId

### Step 3: Enable Bedrock (1 min)
1. Go to AWS Console → Amazon Bedrock
2. Request model access for "Claude 3 Sonnet"
3. Wait 2-3 minutes for approval

### Step 4: Configure Frontend (2 min)
```bash
cd ../frontend
cp .env.example .env
```

Edit `.env` with your values from Step 2:
```env
VITE_API_URL=https://xxxxx.execute-api.ap-southeast-1.amazonaws.com/dev
VITE_COGNITO_USER_POOL_ID=ap-southeast-1_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=your-client-id
VITE_COGNITO_REGION=ap-southeast-1
```

### Step 5: Run Locally (1 min)
```bash
npm run dev
```

Visit http://localhost:3000

### Step 6: Create First User (2 min)
1. Click "Create Account"
2. Enter email and password
3. Verify email
4. Sign in and start using!

### Step 7: Deploy to Production (5 min)
```bash
# Build frontend
npm run build

# Deploy to Amplify
# Go to AWS Amplify Console
# Connect Git repo
# Deploy!
```

## 🧪 Test the Platform

### Create a Task
```bash
# Get auth token first
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id YOUR_CLIENT_ID \
  --auth-parameters USERNAME=test@example.com,PASSWORD=YourPass123! \
  --query 'AuthenticationResult.IdToken' \
  --output text)

# Create task
curl -X POST https://your-api/dev/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Database Assignment",
    "task_type": "assignment",
    "deadline": "2024-12-31T23:59:59Z",
    "difficulty": "medium",
    "estimated_hours": 5,
    "grade_weight": 20
  }'
```

### Test AI Features
```bash
# Get AI prioritization
curl -X POST https://your-api/dev/ai/prioritize \
  -H "Authorization: Bearer $TOKEN"
```

## 📱 Features to Try

1. **Dashboard** - View your task overview
2. **Create Tasks** - Add assignments and deadlines
3. **Modules** - Organize by subject
4. **AI Priority** - Get smart recommendations
5. **Calendar** - See your schedule

## 🔧 Troubleshooting

**Issue:** Cognito auth fails
- Check User Pool ID and Client ID in .env
- Verify email is confirmed

**Issue:** API returns 403
- Ensure JWT token is valid
- Check Cognito authorizer is configured

**Issue:** Bedrock access denied
- Request model access in Bedrock console
- Wait 5-10 minutes after approval

**Issue:** Reminders not sending
- Verify SNS subscription is confirmed
- Check Lambda logs in CloudWatch

## 📚 Next Steps

1. Read full [README.md](README.md) for detailed features
2. Check [DEPLOYMENT.md](DEPLOYMENT.md) for production setup
3. Review [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) for architecture

## 🎯 Demo Flow for Hackathon

1. **Sign up** → Show authentication
2. **Create 3-4 tasks** with different deadlines
3. **Add modules** (e.g., IT2166, IT2164)
4. **View Dashboard** → Show statistics
5. **Click AI Priority** → Demo AI recommendations
6. **Select a task** → Show task breakdown feature
7. **Update progress** → Mark task as in progress
8. **Show reminders** → Explain EventBridge scheduling

---

**Estimated Setup Time:** 15 minutes
**Deployment Time:** 10 minutes
**Total Time to Demo:** 25 minutes

✅ Ready for hackathon presentation!
