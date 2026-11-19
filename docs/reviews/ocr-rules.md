### Rule Group 1: system / default

Applies to:
- src/db/db.ts src/db/seed.ts src/db/probation.ts src/store/modules/work-data/index.ts src/store/modules/applock/index.ts src/store/modules/identity/index.ts src/store/modules/auth/index.ts src/views/calendar/index.vue src/views/dashboard/index.vue src/views/structure/index.vue src/views/library/knowledge/index.vue src/views/library/policy/index.vue src/views/ledger/members/index.vue src/views/ledger/meetings/index.vue src/views/ledger/development/index.vue src/views/ledger/fees/index.vue src/views/ledger/talks/index.vue src/views/settings/index.vue src/utils/handover.ts src/utils/recurrence.ts src/utils/print.ts src/utils/schedule-gen.ts src/utils/hash.ts src/components/custom/app-lock-overlay.vue src/components/custom/empty-fancy.vue src/layouts/modules/global-content/index.vue src/layouts/modules/global-header/components/identity-badge.vue

#### Content

#### Correctness
Is the logic correct? Are there missing boundary conditions?
Are exceptions handled properly?
Is it thread-safe in concurrent scenarios?

#### Security
Are there security vulnerabilities such as SQL injection or XSS?
Is sensitive information handled correctly?
Is permission validation complete?

#### Performance
Are there obvious performance issues (e.g., N+1 queries, unnecessary loops)?
Are resources properly released?

#### Maintainability
Is the code clear and easy to understand?
Do names accurately express intent?
Does it follow the project’s existing code style and architecture patterns?

#### Test Coverage
Do critical logic paths have corresponding test cases?
Do test cases cover boundary conditions?
