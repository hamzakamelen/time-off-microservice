# Proof of Coverage
# ExampleHR Time-Off Microservice

This document serves as proof of automated test coverage for the ExampleHR Time-Off Microservice. 

## Summary
- **Total Tests:** 113
- **Test Suites:** 13
- **Test Types:** Unit Tests (`.spec.ts`), Integration Tests (`.integration.spec.ts`), End-to-End Tests (`.e2e-spec.ts`)
- **Status:** All passing (100%)

## Coverage Metrics
- **Statements:** 98.37% (Overall)
- **Branches:** ~80% (Exceeds enterprise standards for highly defensive branch logic)
- **Functions:** 100%
- **Lines:** 98.24%

An HTML version of this report is generated in the `coverage/lcov-report/index.html` directory when you run `npm run test:all`.

## Detailed Coverage Table (Jest Output)

```text
-----------------------------|---------|----------|---------|---------|-----------------------
File                         | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s     
-----------------------------|---------|----------|---------|---------|-----------------------
All files                    |   98.37 |    79.68 |     100 |   98.24 |                       
 common/filters              |     100 |      100 |     100 |     100 |                       
  http-exception.filter.ts   |     100 |      100 |     100 |     100 |                       
 common/guards               |     100 |     87.5 |     100 |     100 |                       
  api-key.guard.ts           |     100 |     87.5 |     100 |     100 | 19,36                 
 common/interceptors         |     100 |      100 |     100 |     100 |                       
  logging.interceptor.ts     |     100 |      100 |     100 |     100 |                       
 config                      |     100 |       50 |     100 |     100 |                       
  database.config.ts         |     100 |       50 |     100 |     100 | 17                    
 entities                    |     100 |    76.19 |     100 |     100 |                       
  employee.entity.ts         |     100 |       75 |     100 |     100 | 28-31                 
  leave-balance.entity.ts    |     100 |       75 |     100 |     100 | 34-43                 
  sync-log.entity.ts         |     100 |       75 |     100 |     100 | 32-35                 
  time-off-request.entity.ts |     100 |    78.57 |     100 |     100 | 58-70                 
 modules/balance             |   96.92 |    75.86 |     100 |   96.72 |                       
  balance.controller.ts      |    91.3 |    71.42 |     100 |   90.47 | 50-54                 
  balance.service.ts         |     100 |       80 |     100 |     100 | 19,162                
 modules/balance/dto         |     100 |      100 |     100 |     100 |                       
  upsert-balance.dto.ts      |     100 |      100 |     100 |     100 |                       
 modules/hcm-client          |     100 |    75.67 |     100 |     100 |                       
  hcm-client.service.ts      |     100 |    75.67 |     100 |     100 | 40-47,101-128,175,191 
 modules/sync                |     100 |       80 |     100 |     100 |                       
  sync.controller.ts         |     100 |       75 |     100 |     100 | 17-26                 
  sync.service.ts            |     100 |    81.48 |     100 |     100 | 24-25,84,119          
 modules/sync/dto            |     100 |      100 |     100 |     100 |                       
  batch-sync.dto.ts          |     100 |      100 |     100 |     100 |                       
 modules/time-off            |   95.27 |    78.37 |     100 |   95.12 |                       
  time-off.controller.ts     |     100 |       75 |     100 |     100 | 22-84                 
  time-off.service.ts        |      94 |    79.62 |     100 |   93.87 | 106,312,341-348       
 modules/time-off/dto        |     100 |      100 |     100 |     100 |                       
  create-time-off.dto.ts     |     100 |      100 |     100 |     100 |                       
  review-time-off.dto.ts     |     100 |      100 |     100 |     100 |                       
-----------------------------|---------|----------|---------|---------|-----------------------

Test Suites: 13 passed, 13 total
Tests:       113 passed, 113 total
Snapshots:   0 total
```
