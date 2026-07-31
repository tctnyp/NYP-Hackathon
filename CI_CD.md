# CI/CD and Dependency Management

This document explains the automated workflows and dependency management for the Academic Task Manager project.

## 🤖 Dependabot Configuration

Dependabot is configured to automatically update dependencies across the project.

### Schedule
- **Day:** Every Monday
- **Time:** 09:00 AM
- **Updates:** Frontend, Backend, Root workspace, and GitHub Actions

### Configuration

#### Frontend Dependencies (`/frontend`)
- Weekly updates for npm packages
- Open up to 10 pull requests
- Labels: `dependencies`, `frontend`
- Ignores major version updates for React

#### Backend Dependencies (`/backend`)
- Weekly updates for npm packages
- Open up to 10 pull requests
- Labels: `dependencies`, `backend`
- Ignores major AWS SDK updates (require manual testing)

#### Root Workspace (`/`)
- Weekly updates for workspace dependencies
- Open up to 5 pull requests
- Labels: `dependencies`, `workspace`

#### GitHub Actions
- Weekly updates for action versions
- Open up to 5 pull requests
- Labels: `dependencies`, `github-actions`

### Auto-Merge Rules

Dependabot PRs are automatically merged if:
- ✅ Update is a **patch** version (e.g., 1.2.3 → 1.2.4)
- ✅ Update is a **minor** version (e.g., 1.2.3 → 1.3.0)
- ✅ All CI checks pass

Major version updates require manual review.

## 🔄 GitHub Actions Workflows

### 1. Combined CI/CD Pipeline (`ci.yml`)

**Triggers:**
- Push to `main` or `develop` branch
- Pull requests to `main` or `develop`

**Jobs:**
- Detects which components changed
- Runs only relevant checks (frontend or backend)
- Reports overall status

### 2. Frontend CI (`frontend-ci.yml`)

**Runs when:**
- Frontend files change

**Checks:**
- ✅ TypeScript type checking
- ✅ Linting (if configured)
- ✅ Build process
- ✅ Dependency review (on PRs)

**Node versions tested:** 18.x, 20.x

**Artifacts:** Build output uploaded for 7 days

### 3. Backend CI (`backend-ci.yml`)

**Runs when:**
- Backend files change

**Checks:**
- ✅ SAM template validation
- ✅ SAM build process
- ✅ npm audit security scan
- ✅ Trivy vulnerability scanning
- ✅ Linting and tests (if configured)

**Node versions tested:** 18.x, 20.x

**Security:** Results uploaded to GitHub Security tab

### 4. CodeQL Security Analysis (`codeql-analysis.yml`)

**Runs:**
- On push to main/develop
- On pull requests
- **Weekly schedule:** Every Monday at 2 AM

**Analyzes:**
- JavaScript code
- TypeScript code

**Queries:**
- Security extended
- Security and quality

**Results:** Uploaded to GitHub Security tab

### 5. Dependabot Auto-Merge (`dependabot-auto-merge.yml`)

**Runs when:**
- Dependabot opens a PR

**Actions:**
- Auto-approves patch and minor updates
- Enables auto-merge after CI passes
- Comments on major version updates for manual review

## 📊 Status Badges

The README includes status badges for:
- Combined CI/CD pipeline
- Frontend CI
- Backend CI
- CodeQL analysis

These badges show real-time build status.

## 🔐 Security Features

### 1. Dependency Review
Automatically reviews dependencies in pull requests to identify:
- Known vulnerabilities
- Incompatible licenses
- Outdated dependencies

### 2. npm audit
Runs on every backend CI build to detect:
- Security vulnerabilities
- Moderate and higher severity issues

### 3. Trivy Scanning
Scans backend code for:
- Container vulnerabilities
- Filesystem vulnerabilities
- Configuration issues

### 4. CodeQL Analysis
Static analysis to detect:
- Security vulnerabilities
- Code quality issues
- Common programming errors

## 📝 Pull Request Process

### Automated Checks
Every PR triggers:
1. Lint and type checking
2. Build verification
3. Security scans
4. Dependency review

### PR Template
All PRs use a template that requires:
- Description of changes
- Type of change selection
- Component identification
- Checklist completion
- Testing description

### Review Requirements
- All CI checks must pass
- At least one approval (for manual PRs)
- No merge conflicts

## 🐛 Issue Templates

Two issue templates are available:

### Bug Report
- Description of bug
- Steps to reproduce
- Expected behavior
- Environment details
- Error logs

### Feature Request
- Problem description
- Proposed solution
- Alternative solutions
- Component affected
- Implementation ideas

## 📈 Monitoring

### GitHub Insights
View in repository:
- **Actions tab:** See all workflow runs
- **Security tab:** View CodeQL and vulnerability alerts
- **Insights > Dependency graph:** See all dependencies
- **Insights > Network:** See branch/merge activity

### Notifications
You'll receive notifications for:
- Failed workflow runs
- New Dependabot PRs
- Security alerts
- Failed auto-merge attempts

## 🛠️ Configuration Files

```
.github/
├── workflows/
│   ├── ci.yml                    # Combined CI/CD
│   ├── frontend-ci.yml           # Frontend checks
│   ├── backend-ci.yml            # Backend checks
│   ├── codeql-analysis.yml       # Security scanning
│   └── dependabot-auto-merge.yml # Auto-merge bot PRs
├── dependabot.yml                # Dependency updates config
├── PULL_REQUEST_TEMPLATE.md      # PR template
└── ISSUE_TEMPLATE/
    ├── bug_report.md             # Bug report template
    ├── feature_request.md        # Feature request template
    └── config.yml                # Issue template config
```

## 🚀 Triggering Workflows Manually

You can manually trigger workflows from GitHub:

1. Go to **Actions** tab
2. Select the workflow
3. Click **Run workflow**
4. Choose branch and run

## ⚙️ Customization

### Changing Dependabot Schedule

Edit `.github/dependabot.yml`:
```yaml
schedule:
  interval: "daily"  # Options: daily, weekly, monthly
  day: "monday"      # For weekly: monday-sunday
  time: "09:00"      # Time in UTC
```

### Modifying CI Triggers

Edit workflow files:
```yaml
on:
  push:
    branches: [ main, develop, feature/* ]  # Add branches
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '0 0 * * *'  # Add scheduled runs
```

### Adjusting Auto-Merge Rules

Edit `.github/workflows/dependabot-auto-merge.yml`:
```yaml
if: |
  steps.metadata.outputs.update-type == 'version-update:semver-patch'
  # Remove this line to disable auto-merge for minor updates
```

## 📚 Best Practices

1. **Review Dependabot PRs regularly** - Don't let them pile up
2. **Check failed workflows immediately** - Fix issues quickly
3. **Keep workflows updated** - Dependabot updates actions too
4. **Monitor security alerts** - Address vulnerabilities promptly
5. **Test locally before pushing** - Reduce CI failures

## 🔗 Useful Links

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Dependabot Documentation](https://docs.github.com/en/code-security/dependabot)
- [CodeQL Documentation](https://codeql.github.com/docs/)
- [SAM CLI Documentation](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-command-reference.html)

## 💡 Tips

### Viewing Logs
```bash
# View failed workflow logs
gh run view <run-id> --log-failed

# List recent runs
gh run list

# Watch a workflow run
gh run watch
```

### Testing Workflows Locally
```bash
# Install act
# https://github.com/nektos/act

# Test workflow
act -j frontend-check
```

### Dependabot Commands
Comment on Dependabot PRs with:
- `@dependabot rebase` - Rebase the PR
- `@dependabot recreate` - Recreate the PR
- `@dependabot merge` - Merge when CI passes
- `@dependabot close` - Close the PR
- `@dependabot ignore this major version` - Ignore this major version

---

**Status:** ✅ All workflows configured and active

**Last Updated:** 2026-07-30

**Maintained By:** Academic Task Manager Team
