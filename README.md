# Academic Task Manager

> **AI-Powered Task Management Platform for Polytechnic Students**

An intelligent academic task management system built for the NYP Hackathon. Helps polytechnic students track deadlines, prioritize assignments, and manage their academic workload with AI-powered recommendations.

## 🌟 Features

### Core Features
- ✅ **Task Management** - Create, update, delete academic tasks (assignments, tests, projects, presentations)
- 📚 **Module Organization** - Organize tasks by module/subject
- ⏰ **Smart Reminders** - Automated deadline notifications via email
- 📊 **Dashboard Analytics** - Visual overview of workload and upcoming deadlines
- 🎯 **Priority Tracking** - Automatic priority scoring based on urgency, importance, and effort

### AI-Powered Features (Amazon Bedrock)
- 🤖 **Intelligent Task Prioritization** - AI recommends which tasks to focus on
- 📋 **Automatic Task Breakdown** - AI splits large assignments into manageable subtasks
- 📅 **Smart Study Planning** - AI generates daily focus plans
- ⚠️ **Workload Analysis** - Detects deadline clashes and overwhelming periods

### Technical Highlights
- 🚀 **Serverless Architecture** - AWS Lambda + DynamoDB for scalability
- 🔐 **Secure Authentication** - AWS Cognito user management
- 📱 **Responsive Design** - Modern React UI with Tailwind CSS
- ☁️ **AWS Amplify Hosting** - Static site deployment
- 🔔 **EventBridge Scheduling** - Automated reminder checks every 15 minutes

## 🏗️ Architecture

```
┌─────────────┐
│   React     │  ← AWS Amplify (Static Hosting)
│  Frontend   │
└──────┬──────┘
       │
       ↓
┌──────────────┐
│ API Gateway  │  ← Cognito Authorization
└──────┬───────┘
       │
       ↓
┌──────────────────────────────────────┐
│          Lambda Functions            │
│  ┌────────────────────────────────┐  │
│  │ • Task CRUD (get, create,     │  │
│  │   update, delete)              │  │
│  │ • Module management            │  │
│  │ • Dashboard analytics          │  │
│  │ • AI prioritization (Bedrock) │  │
│  │ • AI task breakdown (Bedrock) │  │
│  │ • Reminder checker             │  │
│  └────────────────────────────────┘  │
└────────┬──────────────┬──────────────┘
         │              │
         ↓              ↓
    ┌─────────┐   ┌──────────┐
    │DynamoDB │   │   SNS    │
    │ Tables  │   │  Topic   │
    └─────────┘   └──────────┘
         │
    ┌────┴────┐
    │ Tasks   │
    │ Users   │
    └─────────┘
         │
         ↓
    EventBridge (15 min schedule)
```

## 🗄️ Database Schema (DynamoDB)

### Tasks Table
Single-table design with the following access patterns:
- **PK:** `USER#<user_id>`, **SK:** `TASK#<task_id>`
- **GSI1:** Tasks by deadline (for sorting)
- **GSI2:** Tasks by module (for filtering)
- **GSI3:** Tasks by status + priority (for prioritization)
- **GSI4:** Reminders by task (for notifications)

Entity types in the same table:
- `TASK` - Academic tasks
- `MODULE` - Course modules
- `SUBTASK` - Task breakdowns
- `REMINDER` - Scheduled notifications
- `AI_RECOMMENDATION` - Cached AI suggestions (with TTL)

## 🚀 Getting Started

### Prerequisites
- Node.js 18.x or higher
- AWS Account with appropriate permissions
- AWS CLI configured
- AWS SAM CLI installed

### Environment Setup

1. **Clone the repository**
```bash
cd NYP-Hackathon
```

2. **Install dependencies**
```bash
npm run install-all
```

3. **Configure environment variables**
```bash
cp .env.example .env
# Edit .env with your AWS credentials and configuration
```

### Backend Deployment

1. **Build and deploy Lambda functions**
```bash
cd backend
sam build
sam deploy --guided
```

2. **Note the outputs:**
   - API Gateway URL
   - Cognito User Pool ID
   - Cognito Client ID

3. **Update frontend configuration** with these values

### Frontend Deployment

1. **Configure Amplify**
```bash
cd frontend
# Create src/aws-exports.js with your Cognito and API settings
```

2. **Run locally**
```bash
npm run dev
```

3. **Build for production**
```bash
npm run build
```

4. **Deploy to Amplify**
   - Connect your Git repository to AWS Amplify
   - Or upload the `dist` folder manually

## 📝 API Endpoints

### Tasks
- `GET /tasks` - Get all tasks (with filters: status, module_id, task_type)
- `POST /tasks` - Create a new task
- `PUT /tasks/{taskId}` - Update a task
- `DELETE /tasks/{taskId}` - Delete a task

### Modules
- `GET /modules` - Get all modules
- `POST /modules` - Create a module
- `PUT /modules/{moduleId}` - Update a module
- `DELETE /modules/{moduleId}` - Delete a module

### Dashboard
- `GET /dashboard` - Get analytics and overview

### AI Features
- `POST /ai/prioritize` - Get AI prioritization recommendations
- `POST /ai/breakdown/{taskId}` - Get AI task breakdown

## 🧪 Testing

### Sample Data
Load sample data into DynamoDB:
```bash
# Use the sample_data.sql as reference to create test items
# Convert to DynamoDB PutItem commands
```

### Test API Endpoints
```bash
# Get Cognito token
aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH \
  --client-id YOUR_CLIENT_ID \
  --auth-parameters USERNAME=test@example.com,PASSWORD=TestPass123!

# Test API with token
curl -H "Authorization: Bearer <token>" \
  https://your-api-url/dev/tasks
```

## 🎨 Frontend Structure

```
frontend/
├── src/
│   ├── components/        # Reusable UI components
│   │   ├── Dashboard.jsx
│   │   ├── TaskList.jsx
│   │   ├── TaskForm.jsx
│   │   ├── Calendar.jsx
│   │   └── PriorityView.jsx
│   ├── services/          # API calls
│   │   ├── api.js
│   │   └── auth.js
│   ├── hooks/             # Custom React hooks
│   ├── utils/             # Helper functions
│   ├── App.jsx            # Main app component
│   ├── main.jsx           # Entry point
│   └── index.css          # Tailwind CSS
├── public/
└── index.html
```

## 🔐 Security

- **Authentication:** AWS Cognito with JWT tokens
- **Authorization:** API Gateway Cognito authorizer
- **API Security:** CORS configured, HTTPS only
- **Data Protection:** DynamoDB encryption at rest
- **IAM Roles:** Least privilege principle for Lambda functions

## 📊 Cost Optimization

### DynamoDB
- Pay-per-request billing (no idle capacity costs)
- TTL for automatic AI cache cleanup

### Lambda
- Appropriate memory allocation (512MB)
- Short timeout values (30s standard, 60s for AI)
- Connection reuse where possible

### API Gateway
- REST API (cheaper than HTTP API for this scale)

## 🤝 Team Contributions

This project demonstrates:
- Full-stack serverless development
- AWS service integration (Lambda, DynamoDB, Cognito, Bedrock, SNS, EventBridge, Amplify)
- AI/ML integration with Amazon Bedrock
- Modern React development
- RESTful API design
- DynamoDB single-table design patterns

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- NYP Hackathon organizers
- AWS for cloud services
- Anthropic Claude via Amazon Bedrock for AI capabilities

---

**Built with ❤️ for Polytechnic Students**