# Academic Tasks

> **Branch:** `main` — approved final production source.

Academic Tasks helps students manage assignments, modules, deadlines, progress, and reminders through a responsive browser interface.

## Production feature set

- Cognito authentication and account protection
- Task creation, editing, filtering, progress tracking, and deletion
- Module-based organization
- Dashboard statistics and deadline visibility
- Calendar view
- Scheduled reminder checks and SNS notifications
- Administrator user-management controls
- Responsive React interface

Experimental planning routes and their frontend surface are intentionally excluded from `main`.

## Source map

```text
frontend/src/            Browser application source
backend/src/handlers/    Production Lambda handlers
backend/src/utils/       Shared data and response helpers
backend/template.yaml    Production serverless resources
database/                Reference schemas and sample data
```

## Branch policy

- `dev` contains active and experimental work.
- `main` exposes only the approved final production feature surface.

Operational installation, deployment, credentials, and hosting procedures are intentionally not published in this repository.

## More information

See the [GitHub Wiki](https://github.com/tctnyp/NYP-Hackathon/wiki) for architecture, feature behavior, data flow, security boundaries, and branch policy.

## License

Licensed under the repository's [LICENSE](LICENSE).
