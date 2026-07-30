# Academic Task Manager - Project Summary

## 🎯 Project Overview

A complete AI-powered academic task management platform built for the NYP Hackathon, specifically designed for polytechnic students to manage deadlines, assignments, and projects with intelligent prioritization.

## 📁 Project Structure

```
NYP-Hackathon/
├── backend/                    # AWS Lambda Functions (JavaScript)
│   ├── src/
│   │   ├── handlers/          # Lambda function handlers
│   │   │   ├── createTask.js
│   │   │   ├── getTasks.js
│   │   │   ├── updateTask.js
│   │   │   ├── deleteTask.js
│   │   │   ├── modules.js
│   │   │   ├── getDashboard.js
│   │   │   ├── aiPrioritize.js
│   │   │   ├── aiBreakdown.js
│   │   │   └── reminderChecker.js
│   │   └── utils/
│   │       ├── database.js     # DynamoDB client wrapper
│   │       └── response.js     # Lambda response utilities
│   ├── template.yaml           # AWS SAM template
│   └── package.json
│
├── frontend/                   # React App (TypeScript)
│   ├── src/
│   │   ├── components/        # React components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── TaskList.jsx
│   │   │   ├── Modules.jsx
│   │   │   ├── Calendar.jsx
│   │   │   ├── PriorityView.jsx
│   │   │   └── Layout.tsx
│   │   ├── services/
│   │   │   └── api.ts          # API client with TypeScript
│   │   ├── types/
│   │   │   └── api.ts          # TypeScript type definitions
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.css           # Tailwind CSS
│   │   └── aws-exports.js      # AWS Amplify config
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── package.json
│
├── database/
│   ├── dynamodb-schema.md      # DynamoDB table design
│   └── sample_data.sql         # Sample data reference
│
├── README.md                   # Comprehensive documentation
├── DEPLOYMENT.md               # Deployment guide
└── package.json                # Root workspace config
```

## 🛠️ Technology Stack

### Backend (JavaScript)
- **Runtime:** Node.js 18.x
- **Framework:** AWS Lambda (Serverless)
- **Database:** Amazon DynamoDB
- **AI:** Amazon Bedrock (Claude 3 Sonnet)
- **Notifications:** Amazon SNS
- **Scheduling:** Amazon EventBridge
- **IaC:** AWS SAM (Serverless Application Model)

### Frontend (TypeScript)
- **Framework:** React 18
- **Language:** TypeScript 5.3
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **Auth:** AWS Amplify + Cognito
- **HTTP Client:** Axios
- **Routing:** React Router v6
- **Icons:** Lucide React
- **Date Utilities:** date-fns

### AWS Services Used
1. **Lambda** - Serverless compute for API endpoints
2. **DynamoDB** - NoSQL database with single-table design
3. **API Gateway** - REST API with Cognito authorizer
4. **Cognito** - User authentication and management
5. **Bedrock** - AI/ML for task prioritization and breakdown
6. **SNS** - Email notifications for reminders
7. **EventBridge** - Scheduled reminder checking (every 15 min)
8. **Amplify** - Frontend hosting and CI/CD

## ✨ Features Implemented

### Core Features
✅ Task CRUD operations (Create, Read, Update, Delete)
✅ Module/Subject organization
✅ Dashboard with statistics and analytics
✅ Task filtering by status, module, type
✅ Deadline tracking with urgency levels
✅ Progress tracking (percentage completion)
✅ Priority scoring algorithm

### AI-Powered Features (Amazon Bedrock)
✅ Intelligent task prioritization with explanations
✅ Automatic task breakdown into subtasks
✅ Workload assessment and warnings
✅ 3-day focus plan generation
✅ Deadline clash detection

### User Experience
✅ Responsive design (mobile, tablet, desktop)
✅ Real-time authentication with AWS Cognito
✅ Clean, modern UI with Tailwind CSS
✅ Type-safe API calls with TypeScript
✅ Loading states and error handling

### Backend Features
✅ DynamoDB single-table design with GSIs
✅ JWT-based authentication
✅ CORS-enabled API
✅ Automated reminders via EventBridge
✅ Email notifications via SNS
✅ Priority score calculation
✅ AI recommendation caching with TTL

## 🗄️ Database Design

### DynamoDB Single-Table Design

**Main Table:** `academic-tasks`

**Entities:**
- Tasks: `PK: USER#{userId}`, `SK: TASK#{taskId}`
- Modules: `PK: USER#{userId}`, `SK: MODULE#{moduleId}`
- Subtasks: `PK: USER#{userId}`, `SK: TASK#{taskId}#SUBTASK#{subtaskId}`
- Reminders: `PK: REMINDER#{date}#{hour}`, `SK: TASK#{taskId}#{reminderId}`
- AI Recommendations: `PK: USER#{userId}`, `SK: AI#{type}#{timestamp}`

**Global Secondary Indexes:**
- **GSI1 - TasksByDeadline:** Sort tasks by deadline
- **GSI2 - TasksByModule:** Filter tasks by module
- **GSI3 - TasksByStatus:** Filter by status and priority
- **GSI4 - RemindersByTask:** Query reminders for a task

**TTL:** Automatic cleanup of expired AI recommendations

## 🚀 API Endpoints

### Tasks
- `GET /tasks` - List all tasks (with filters)
- `POST /tasks` - Create new task
- `PUT /tasks/{taskId}` - Update task
- `DELETE /tasks/{taskId}` - Delete task

### Modules
- `GET /modules` - List all modules
- `POST /modules` - Create module
- `PUT /modules/{moduleId}` - Update module
- `DELETE /modules/{moduleId}` - Delete module

### Dashboard
- `GET /dashboard` - Get statistics and analytics

### AI Features
- `POST /ai/prioritize` - Get AI prioritization
- `POST /ai/breakdown/{taskId}` - Get task breakdown

### Background Jobs
- EventBridge triggers `/reminder-checker` every 15 minutes

## 📦 Deployment

### Backend Deployment
```bash
cd backend
npm install
sam build
sam deploy --guided
```

### Frontend Deployment
```bash
cd frontend
npm install
npm run build
# Deploy to AWS Amplify via console or CLI
```

## 🔐 Security

- **Authentication:** AWS Cognito with JWT tokens
- **Authorization:** API Gateway Cognito authorizer
- **Data Encryption:** DynamoDB encryption at rest
- **HTTPS Only:** All API communication over TLS
- **IAM Roles:** Least privilege principle for Lambda

## 💰 Cost Optimization

- **DynamoDB:** Pay-per-request billing
- **Lambda:** 512MB memory, appropriate timeouts
- **API Gateway:** REST API for cost efficiency
- **TTL:** Automatic cleanup of stale data
- **Caching:** AI recommendations cached to reduce Bedrock calls

## 🎨 UI/UX Highlights

- **Responsive Design:** Mobile-first approach
- **Loading States:** Skeleton screens and spinners
- **Error Handling:** User-friendly error messages
- **Color Coding:** Module colors, urgency badges
- **Icons:** Consistent Lucide icon library
- **Accessibility:** Semantic HTML, ARIA labels

## 📊 Key Metrics Tracked

- Total tasks, completed, in progress, overdue
- Completion rate percentage
- Tasks due today/this week
- High priority tasks
- Workload by week
- Tasks by module

## 🧠 AI Integration

### Amazon Bedrock - Claude 3 Sonnet

**Prioritization:**
- Analyzes all active tasks
- Considers deadline urgency, grade weight, estimated effort
- Provides top 3 priorities with reasoning
- Warns about deadline clashes
- Generates 3-day focus plan

**Task Breakdown:**
- Splits large assignments into 4-8 subtasks
- Each subtask is specific and actionable
- Estimates time for each subtask
- Provides study tips
- Automatically creates subtasks in database

## 📝 Code Quality

- **TypeScript:** Type-safe frontend code
- **ESLint:** Linting for code consistency
- **Error Handling:** Comprehensive try-catch blocks
- **Comments:** Clear documentation in code
- **Modular:** Reusable components and utilities

## 🔄 Future Enhancements

- Calendar view with drag-and-drop
- Group collaboration features
- Mobile app (React Native)
- Integration with LMS systems
- Study timer and Pomodoro
- Progress analytics and insights
- Push notifications
- Export to PDF/CSV

## 📞 Support

For issues or questions:
1. Check CloudWatch logs
2. Review DynamoDB table structure
3. Test API endpoints with curl
4. Verify IAM permissions

---

**Project Status:** ✅ Complete and ready for deployment

**Hackathon Ready:** Yes - All core and AI features implemented

**Documentation:** Comprehensive README and deployment guide included

**Demo Ready:** Yes - Sample data and test flows prepared
