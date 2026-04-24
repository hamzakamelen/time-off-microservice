# ExampleHR Time-Off Microservice

A production-hardened NestJS microservice that manages employee time-off requests and keeps leave balances synchronized with an external HCM (Human Capital Management) system.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js:** v18 or higher
- **NPM:** v9 or higher

### 2. Clone the Repository
```bash
git clone https://github.com/hamzakamelen/time-off-microservice.git
cd time-off-microservice
```

### 3. Setup
```bash
# 1. Install dependencies
npm install

# 2. Configure environment
# On Mac/Linux:
cp .env.example .env
# On Windows:
copy .env.example .env
# (Optional) Edit .env if you want to change ports or keys
```

### 4. Run the System
You need to run **two** processes simultaneously:

| Terminal | Command | Purpose |
| :--- | :--- | :--- |
| **Terminal 1** | `npm run start:dev` | Main Time-Off Microservice (Port 3000) |
| **Terminal 2** | `npm run start:mock-hcm` | Mock HCM Server (Port 3001) |

### 5. Explore the API
Once running, visit the interactive dashboard to see all endpoints:
👉 **[http://localhost:3000/api/docs](http://localhost:3000/api/docs)** (Swagger UI)

---

## 🧪 Quality & Testing

This project is built with **Test-Driven Development (TDD)** and high engineering standards.

```bash
# Run all tests (Unit + Integration + E2E)
npm run test:all
```

**Current Stats:**
- **Total Tests:** 113+ passing
- **Code Coverage:** **~98% Statement Coverage**
- **Quality Gates:** Includes validation pipes, global exception filters, and security middleware.

---

## 📖 Documentation

For a deep dive into the system, please refer to the files in the `docs/` folder:

1. **[TRD.md](docs/TRD.md)** — Technical Requirement Document covering the challenges, data model, sync strategies, and analysis of alternatives considered.
2. **[PROOF_OF_COVERAGE.md](docs/PROOF_OF_COVERAGE.md)** — Detailed metrics and proof of the 98%+ automated test coverage.

---

## 🛠️ Key Architectural Features

- **Resiliency:** Implemented exponential backoff for HCM communication and automatic balance restoration on sync failure.
- **Security:** Integrated `helmet` for HTTP headers and `ThrottlerModule` for rate limiting/DDoS protection.
- **Integrity:** Uses **Optimistic Locking** (`@VersionColumn`) and TypeORM transactions to prevent race conditions during high-concurrency approvals.
- **Auditability:** Every HCM sync is logged, and the request history tracks exactly who reviewed each request and when.

---

## 📦 Tech Stack

- **Framework:** NestJS 11 (TypeScript)
- **Database:** SQLite (Local) / TypeORM
- **Security:** API Key Auth, Helmet, Rate Limiting
- **Documentation:** Swagger / OpenAPI 3.0
- **Testing:** Jest 30, Supertest, RXJS (for async retries)
