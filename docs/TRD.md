# Technical Requirement Document (TRD)
# ExampleHR Time-Off Microservice

## 1. Executive Summary

ExampleHR needs a backend microservice to manage employee time-off requests while keeping leave balances synchronized with an external Human Capital Management (HCM) system (e.g., Workday, SAP).

**The core challenge:** ExampleHR is NOT the only system that updates the HCM. Work anniversaries, year-start resets, and manual HR adjustments can independently change balances. Our service must handle this gracefully.

**Solution:** A NestJS-based REST API microservice with SQLite storage that:
- Manages the full lifecycle of time-off requests (submit → approve/reject → sync)
- Maintains a local cache of balances with sync mechanisms
- Defensively validates balances before AND during approval
- Handles HCM failures with automatic rollback

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────┐
│                  ExampleHR Microservice               │
│                                                       │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐       │
│  │ Balance   │  │  Time-Off    │  │   Sync   │       │
│  │ Module    │  │  Module      │  │  Module  │       │
│  │           │  │              │  │          │       │
│  │ • CRUD    │  │ • Create     │  │ • Batch  │       │
│  │ • Deduct  │  │ • Approve    │  │ • Trigger│       │
│  │ • Restore │  │ • Reject     │  │ • Status │       │
│  │ • Refresh │  │ • Cancel     │  │ • Audit  │       │
│  └─────┬─────┘  └──────┬───────┘  └─────┬────┘       │
│        │               │                │             │
│        └───────────┬────┘────────────────┘             │
│                    │                                   │
│              ┌─────▼──────┐     ┌──────────┐          │
│              │  HCM Client│     │  SQLite  │          │
│              │  (HTTP)    │     │  Database │          │
│              └─────┬──────┘     └──────────┘          │
└────────────────────┼──────────────────────────────────┘
                     │
              ┌──────▼──────┐
              │  External   │
              │  HCM System │
              │  (Workday/  │
              │   SAP)      │
              └─────────────┘
```

### Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| **Balance Module** | CRUD for leave balances, local deduction/restore, HCM refresh |
| **Time-Off Module** | Request lifecycle management, state machine enforcement |
| **Sync Module** | Batch sync processing, full sync trigger, audit logging |
| **HCM Client Module** | HTTP wrapper for all HCM communication |

---

## 3. Data Model

### 3.1 Employee
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated |
| employeeId | string (unique) | External ID from HCM (e.g., "EMP-001") |
| name | string | Employee name |
| email | string (nullable) | Email address |

### 3.2 LeaveBalance
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated |
| employeeId | string | References Employee |
| locationId | string | Office location (e.g., "LOC-NYC") |
| leaveType | string | "ANNUAL", "SICK", "PERSONAL" |
| balance | real | Number of days available |
| lastSyncedAt | datetime | Last HCM sync timestamp |
| version | int | Optimistic lock counter |

**Unique constraint:** `(employeeId, locationId, leaveType)`

### 3.3 TimeOffRequest
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated |
| employeeId | string | Who's requesting |
| locationId | string | Which office |
| leaveType | string | Type of leave |
| startDate | string | ISO date (e.g., "2026-06-01") |
| endDate | string | ISO date |
| numberOfDays | real | Duration |
| status | enum | PENDING → APPROVED/REJECTED/CANCELLED → SYNCED/FAILED |
| reason | string | Employee's reason |
| reviewedBy | string | Manager's ID |
| hcmReferenceId | string | HCM tracking reference |
| rejectionReason | string | Why it was rejected |

### 3.4 SyncLog
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated |
| syncType | string | "BATCH" or "REALTIME" |
| status | string | "SUCCESS", "PARTIAL", "FAILED" |
| details | string (JSON) | Error details |
| recordsProcessed | int | Successfully processed count |
| recordsFailed | int | Failed count |

---

## 4. API Specification

### 4.1 Balance Endpoints

| GET | `/balances` | List all balances (Admin) |
| GET | `/balances/:employeeId` | Get all balances for employee |
| GET | `/balances/:employeeId/:locationId` | Get balance at location |
| POST | `/balances/:employeeId/:locationId/refresh` | Refresh from HCM |
| POST | `/balances` | Create/update a balance |

### 4.2 Time-Off Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/time-off` | Submit new request |
| GET | `/time-off` | List all requests (Admin) |
| GET | `/time-off/:id` | Get request by ID |
| GET | `/time-off/employee/:employeeId` | List employee's requests |
| PATCH | `/time-off/:id/approve` | Manager approves |
| PATCH | `/time-off/:id/reject` | Manager rejects |
| PATCH | `/time-off/:id/cancel` | Employee cancels |

### 4.3 Sync Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/sync/batch` | Receive batch update from HCM |
| POST | `/sync/trigger` | Manually trigger full sync |
| GET | `/sync/status` | Get sync history |

---

## 5. Sync Strategy

### 5.1 Two Sync Mechanisms

1. **Real-time (Pull):** When a user refreshes their balance, we call `GET /api/hcm/balance/:employeeId/:locationId` and update our local record.

2. **Batch (Push or Pull):**
   - **Push:** HCM sends a POST to our `/sync/batch` with all current balances
   - **Pull:** We call HCM's batch endpoint via `/sync/trigger`

### 5.2 Conflict Resolution

When a batch sync arrives:
- For each record, we **upsert** (insert or update) the local balance
- HCM is always considered the **source of truth** for balance values
- We log every sync operation in `SyncLog` for auditing

### 5.3 Independent Balance Changes

When HCM changes a balance independently (e.g., work anniversary bonus):
- The change is invisible to us until the next sync
- Users can force a refresh via the `/refresh` endpoint
- Batch sync updates all records at once

---

## 6. Defensive Design

### Challenge: HCM May Not Always Return Errors

The PDF states: *"we can count on HCM to send back errors... HOWEVER this may not be always guaranteed."*

Our defense strategy:

| Defense Layer | When | What |
|--------------|------|------|
| **Local Pre-check** | On request creation | Check `hasEnoughBalance()` locally |
| **Local Deduction** | On approval | `deductBalance()` with optimistic locking |
| **HCM Verification** | After local deduction | Send to HCM and check response |
| **Auto-rollback** | If HCM rejects | Restore local balance, mark as FAILED |
| **Optimistic Locking** | On concurrent access | Database version column prevents double-spending |

### Flow: What Happens When an Employee Requests Time Off

```
Employee submits 2 days leave
    │
    ▼
[LOCAL CHECK] Does balance >= 2?  ──No──▶ Reject immediately
    │ Yes
    ▼
Create request as PENDING
    │
    ▼
Manager approves
    │
    ▼
[LOCAL DEDUCT] balance -= 2 (with version lock)
    │
    ▼
[HCM SYNC] POST to HCM
    │
    ├── HCM says OK ──▶ Status = SYNCED ✅
    │
    └── HCM says NO ──▶ [ROLLBACK] balance += 2
                        Status = FAILED ❌
```

---

## 7. State Machine

```
                    ┌─────────┐
                    │ PENDING │
                    └────┬────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         ┌────▼────┐┌────▼────┐┌────▼─────┐
         │APPROVED ││REJECTED ││CANCELLED │
         └────┬────┘└─────────┘└──────────┘
              │
      ┌───────┼───────┐
      │               │
 ┌────▼────┐    ┌─────▼────┐
 │ SYNCED  │    │  FAILED  │
 └────┬────┘    └──────────┘
      │
 ┌────▼─────┐
 │CANCELLED │  (if employee cancels after sync)
 └──────────┘
```

**Allowed transitions:**
- PENDING → APPROVED, REJECTED, CANCELLED
- APPROVED → SYNCED, FAILED (automatic, based on HCM response)
- SYNCED → CANCELLED (restores balance + notifies HCM)

---

## 8. Concurrency Control

**Problem:** Two managers approve requests for the same employee simultaneously.

**Solution:** Optimistic locking via TypeORM's `@VersionColumn()`.

```
Request A reads balance: 20 (version 1)
Request B reads balance: 20 (version 1)
Request A deducts 5, saves → balance: 15, version: 2 ✅
Request B deducts 3, saves → VERSION MISMATCH → ConflictException ❌
Request B retries, reads: 15 (version 2), deducts 3 → 12, version: 3 ✅
```

---

## 9. Alternatives Considered

| Alternative | Pros | Cons | Decision |
|------------|------|------|----------|
| **Event Sourcing** | Full audit trail, replay events | Complex, overkill for this scope | ❌ Rejected |
| **CQRS** | Separate read/write models | Added complexity without clear benefit | ❌ Rejected |
| **Polling HCM** | Always fresh data | Wasteful, HCM rate limits | ❌ Rejected |
| **Webhooks from HCM** | Real-time updates | Requires HCM support | ⏳ Future |
| **Pessimistic Locking** | Guarantees exclusive access | Deadlock risk, blocks other requests | ❌ Rejected |
| **Optimistic Locking** | No blocking, simple retry | Rare conflicts need retry | ✅ Chosen |

---

## 10. Security Considerations

Security is a primary concern for any HR-related system, as it deals with personally identifiable information (PII) and core business rules. 

1. **Authentication & Authorization (AuthN/AuthZ):** 
   - *Current Scope:* Assumes an API Gateway or service mesh handles edge authentication.
   - *Target State:* Implement JWT-based RBAC (Role-Based Access Control). Employees can only read their own balances and create requests for themselves. Managers require elevated roles to approve/reject requests.
2. **Input Validation:** 
   - Strict validation pipelines using `class-validator` reject malicious payloads at the controller layer. Custom cross-field validation prevents logic spoofing (e.g., ensuring `endDate >= startDate` and `numberOfDays` does not exceed the mathematical calendar range).
3. **Data Integrity & Concurrency:**
   - Database transactions guarantee that balance deductions and status changes happen atomically. If the server crashes mid-operation, no partial state is saved.
   - Optimistic locking (`@VersionColumn`) entirely eliminates race conditions and double-spending vulnerabilities if multiple managers approve simultaneously.
4. **Resilience to External Manipulation:**
   - The system uses exponential backoff and localized retries, defending against cascading failures if the external HCM experiences a DDoS or outage.
   - Stale data detection (auto-refreshing balances older than 24 hours) mitigates risks of "time-of-check to time-of-use" (TOCTOU) exploits if an employee's balance was recently revoked in the HCM.

---

## 11. Future Considerations

1. **Webhooks** — Register webhooks with HCM for real-time balance change notifications (push-based sync).
2. **Caching** — Add a Redis layer for frequently accessed `GET /balances` endpoints.
3. **Notifications** — Add event emitters to send Email/Slack notifications on request status changes.
4. **Migrations** — Replace `synchronize: true` with TypeORM migrations for production environments.
5. **API Versioning** — Add `/api/v1/` prefix for backward-compatible future iterations.
6. **Authentication** — Replace static API keys with OIDC/JWT-based identity providers.
