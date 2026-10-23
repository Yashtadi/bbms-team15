# How to work on BBMS (read this first)

This guide is for everyone on Team 15. Follow it top to bottom once, and keep it open while you work.
If something here is wrong or unclear, fix it in a PR or tell Yash.

**Contents**

1. [What this project is](#1-what-this-project-is)
2. [One-time setup](#2-one-time-setup)
3. [The folder structure, explained](#3-the-folder-structure-explained)
4. [How the backend code is organised](#4-how-the-backend-code-is-organised)
5. [Your daily workflow (issue → branch → PR → merge)](#5-your-daily-workflow)
6. [Writing tests](#6-writing-tests)
7. [The golden rules](#7-the-golden-rules)
8. [When something goes wrong](#8-when-something-goes-wrong)
9. [Cheat sheet](#9-cheat-sheet)

---

## 1. What this project is

**BBMS (Blood Bank Management System)** tracks blood from donor to patient:
donor registration → collection → lab testing → inventory → hospital request and issuance.

- **What to build** is written in our **SRS** (requirements like `BBMS-F-001`).
- **How to build it** is written in our **SAD** (architecture, API design, error codes).
- **How to test it** is written in our **STP** (test case IDs like `TC-Reg-02`).

The code must follow these three documents. If you have to do something differently, write it down in
`DEVIATIONS.md` (see [rule 7](#7-the-golden-rules)).

**Tech stack**

| Part | Technology | Where it lives |
|---|---|---|
| Frontend (what users see) | React, built with Vite | `client/` *(being added in the skeleton work)* |
| Backend (the API) | Node.js + Express | `server/` |
| Database | MySQL | `server/db/` *(added in the "DB schema v1" issue)* |
| Login and roles | JWT + role checks (RBAC) | `server/src/middleware/auth.js` |
| Tests | Jest + Supertest (server), Vitest + React Testing Library (client) | `server/tests/`, `client/src/**/*.test.jsx` |

**Words you will see**

| Word | Meaning |
|---|---|
| **Repo** | The project folder that Git tracks, hosted on GitHub. |
| **Commit** | A saved snapshot of your changes, with a message. |
| **Branch** | Your own copy of the code where you can work without affecting anyone else. |
| **`main`** | The shared branch. It must always work. Nobody pushes to it directly. |
| **PR (Pull Request)** | A request on GitHub to merge your branch into `main`. A teammate reviews it first. |
| **Issue** | A task on GitHub (one per requirement, e.g. `[F-001] Donor registration`). |
| **API / endpoint** | A URL the frontend calls to get or change data, e.g. `POST /api/donors`. |
| **Middleware** | A function that runs *before* your route code, e.g. "is this user logged in?". |
| **CI** | GitHub Actions automatically running our tests on every push. |

---

## 2. One Time Setup

### 2.1 Download the project

```bash
git clone https://github.com/Yashtadi/bbms-team15.git
cd bbms-team15
```

### 2.2 Install the backend's packages

```bash
cd server
npm install
```

This reads `package.json` and downloads everything into `server/node_modules/`.
That folder is huge and is **never committed** (it is listed in `.gitignore`).

### 2.3 Create your own `.env` file

The server reads settings (port, database password, secret key) from a file called `.env`.
Everyone has their own, because everyone's MySQL password is different. We share a template called
`.env.example`, and each person copies it.

```bash
# Mac / Linux / Git Bash
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Then open `server/.env` and fill in your own values:

| Setting | What it is | What to put |
|---|---|---|
| `PORT` | Port the API runs on | Leave as `4000` |
| `DB_HOST`, `DB_PORT` | Where MySQL runs | Leave as `127.0.0.1` and `3306` |
| `DB_USER`, `DB_PASSWORD` | Your MySQL login | Your own MySQL username and password |
| `DB_NAME` | Database name | Leave as `bbms` |
| `JWT_SECRET` | Secret used to sign login tokens | Any long random string |

> ⚠️ **Never commit `.env`.** It contains passwords. Git already ignores it. Don't force-add it.
> If you add a **new** setting, add it to `.env.example` too (with a fake value) so teammates know about it.


### 2.4 Set up the database

You need MySQL 8 installed and running. Your MySQL username and password must be in `server/.env`.

```bash
npm run db:setup
```

You should see `Database "bbms" is ready.`

This creates the `bbms` database, all tables (`server/db/schema.sql`) and fake test data
(`server/db/seed.sql`). **Run it again any time you want a fresh database. It deletes all data.**
Run it again after pulling changes to `schema.sql` or `seed.sql`.

### 2.5 Check everything works

**Run the tests:**

```bash
npm test
```

You should see:

```
Test Suites: 3 passed, 3 total
Tests:       6 passed, 6 total
```

**Start the server:**

```bash
npm run dev
```

You should see `BBMS API running on http://localhost:4000`.
Open http://localhost:4000/api/health in your browser. You should see:

```json
{"status":"ok"}
```

Stop the server with **Ctrl + C**.

If both work, your setup is done. 🎉

---

## 3. The folder structure, explained

```
bbms-team15/
├── .gitignore                 Files Git must never track (node_modules, .env, ...)
├── README.md                  Project front page on GitHub
├── CONTRIBUTING.md            This guide
├── DEVIATIONS.md              (coming) Where we differ from SRS/SAD/STP, and why
├── client/                    React frontend (Vite)
│   ├── vite.config.js         Vite config, plus the Vitest test settings
│   └── src/
│       ├── App.jsx            The root React component
│       ├── App.test.jsx       Client tests sit next to the component they test
│       └── test/
│           └── setup.js       Runs before client tests (adds matchers like toBeInTheDocument)
└── server/                    Node.js + Express backend
    ├── package.json           Project info, scripts (npm test, npm run dev), list of packages
    ├── package-lock.json      Exact package versions. Commit it, never edit it by hand.
    ├── .env.example           Template for .env (committed, fake values only)
    ├── .env                   YOUR settings (NOT committed)
    ├── node_modules/          Downloaded packages (NOT committed)
    ├── src/
    │   ├── server.js          Starts the server: loads .env, listens on PORT
    │   ├── app.js             Builds the Express app: middleware + connects every module's URLs
    │   ├── middleware/
    │   │   └── auth.js        requireAuth / requireRole: who is allowed to call a URL
    │   └── modules/           One folder per part of the system
    │       ├── auth/          Login, roles, MFA        → SR-002, SR-005
    │       ├── donor/         Donor registration       → F-001 to F-004
    │       ├── collection/    Donation sessions        → F-010 to F-013
    │       ├── lab/           Blood tests              → F-020 to F-023
    │       ├── inventory/     Stock, expiry, FEFO      → F-030 to F-034
    │       └── request/       Hospital requests        → F-040 to F-044
    └── tests/                 Automated tests (Jest)
        ├── unit/              No server, no DB
        │   └── auth.middleware.test.js
        └── integration/       Real HTTP requests (Supertest) and/or the real DB
            ├── health.test.js
            └── db.schema.test.js
```

### What each important file does

**`server/src/server.js`.** This is the entry point. It loads `.env`, then starts the app on port 4000.
You will almost never touch it.

**`server/src/app.js`.** This file builds the app. It:
1. Turns on `cors` (so the React app on port 5173 is allowed to call the API on port 4000).
2. Turns on `express.json()` (so `req.body` contains the JSON the frontend sent).
3. Defines `GET /api/health` (a simple "is the server alive?" check).
4. Connects each module to a URL prefix:

| URL prefix | Module folder |
|---|---|
| `/api/auth` | `modules/auth/` |
| `/api/donors` | `modules/donor/` |
| `/api/donations` | `modules/collection/` |
| `/api/lab` | `modules/lab/` |
| `/api/inventory` | `modules/inventory/` |
| `/api/blood-requests` | `modules/request/` |

So a route you write as `router.post('/')` in `donor.routes.js` becomes `POST /api/donors`.
**`app.js` and `server.js` are kept separate on purpose.** Tests import `app.js` without starting a real
server.

**`server/src/middleware/auth.js`.** This file decides who is allowed to call a URL.
- `ROLES`: the 5 roles from the SRS: `DONOR`, `LAB_TECH`, `MANAGER`, `HOSPITAL`, `ADMIN`.
- `requireAuth`: "the user must be logged in".
- `requireRole('LAB_TECH', 'ADMIN')`: "the user must have one of these roles".

> **Right now this is a temporary stub (placeholder).** It lets every request through, so you can build and
> test your feature without a login system. **Still put `requireRole(...)` on your routes today.** When
> the SR-002 issue is merged, it will start blocking wrong roles automatically (401 / 403), and you won't
> need to change your code. It already throws an error if you misspell a role (e.g. `'LABTECH'`).

**`server/src/modules/<name>/<name>.routes.js`.** These are empty routers right now. Each one has a comment
listing which requirements belong to it. This is where you start working.

---

## 4. How the backend code is organised

Our SAD says every module has **three layers**. Each layer has one job:

```
 Browser / React
      │  HTTP request: POST /api/donors  { name, dob, weight, ... }
      ▼
 donor.routes.js       URL + role check + read input + send response
      │  calls
      ▼
 donor.service.js      Business rules (e.g. eligibility: age 18–65, weight ≥ 45 kg)
      │  calls
      ▼
 donor.repository.js   SQL only. Talks to MySQL.
      │
      ▼
   MySQL
```

| Layer | File | Does | Does NOT |
|---|---|---|---|
| Routes | `donor.routes.js` | Define the URL, `requireRole`, read `req.body`, choose the status code, send JSON | Contain business rules or SQL |
| Service | `donor.service.js` | Rules from the SRS (eligibility, status changes, FEFO, ...) | Know about `req`/`res` or write SQL |
| Repository | `donor.repository.js` | Run SQL queries and return rows | Contain business rules |

**Why bother?** Each piece can be tested on its own. For example, you can unit-test eligibility rules in
the service without a database or a web server. It also means two people rarely edit the same file.

### Example shape of a module

This shows the pattern only. It is not a finished feature, and the names are illustrative.

```js
// donor.routes.js
const express = require('express');
const { requireRole } = require('../../middleware/auth');
const donorService = require('./donor.service');

const router = express.Router();

router.post('/', requireRole('LAB_TECH', 'ADMIN'), async (req, res) => {
  const result = await donorService.registerDonor(req.body);
  res.status(201).json(result);            // SAD: POST /api/donors → { donorId, status }
});

module.exports = router;
```

```js
// donor.service.js
const donorRepository = require('./donor.repository');

async function registerDonor(input) {
  // business rules from the SRS go here
  return donorRepository.insertDonor(input);
}

module.exports = { registerDonor };
```

```js
// donor.repository.js
// SQL only. ALWAYS use ? placeholders. NEVER build SQL by gluing strings together.
//   ✅ db.query('SELECT * FROM donors WHERE donor_id = ?', [id])
//   ❌ db.query('SELECT * FROM donors WHERE donor_id = ' + id)   ← SQL injection risk
```

### Status codes (from the SAD). Use these, and only these.

| Code | When to use it | Example |
|---|---|---|
| `200` | OK (reading or updating) | `GET /api/inventory` |
| `201` | Created something new | Donor registered |
| `400` | The input is malformed or missing | No `dob` field |
| `401` | Not logged in | No/invalid token |
| `403` | Logged in, but wrong role | A DONOR trying to enter lab results |
| `404` | That thing does not exist | Unknown donor ID |
| `409` | Conflicts with the current state | Issuing a unit that is still in QUARANTINE |
| `422` | Input is valid but breaks a business rule | Donor is 17, so not eligible |
| `429` | Too many requests | Rate limit |
| `500` / `503` | Server broke / unavailable | Unexpected error |

### Where the database code lives

- `server/db/schema.sql`: all tables. This is the contract between modules. **Don't invent your own
  tables.** If you need a new column, change `schema.sql` in your PR and mention it in the PR description.
- `server/db/seed.sql`: fake data for testing (users for every role, donors, units in every status).
- `server/src/db.js`: the shared connection. In a repository: `const db = require('../../db');`


---

## 5. Your daily workflow

Every piece of work follows the same loop:
**claim issue → branch → code + tests → commit → push → PR → review → merge → done.**

### Step 1: Claim the issue on the board

On GitHub → **Projects → "BBMS – Team 15"**, open your issue and:
- **Assignees:** yourself
- **Story Points:** your estimate (1, 2, 3, 5)
- **Sprint:** the current sprint
- Drag the card to **In Progress**

### Step 2: Get the latest `main` and create your branch

```bash
git switch main
git pull
git switch -c feature/F-001-donor-registration
```

**Branch names:** `feature/<id>-<short-name>` for new work, `fix/<short-name>` for bug fixes.
Always branch from the **latest `main`**, never from a teammate's branch.

### Step 3: Write code and tests

Run `npm test` often. Run `npm run dev` to try your endpoints (with the browser, Postman or Thunder
Client).

### Step 4: Commit in small steps

```bash
git status                 # see what changed. CHECK there is no .env or node_modules here
git add <the files you changed>
git commit -m "feat(donor): validate donor age and weight"
```

**Commit message prefixes**

| Prefix | Use for |
|---|---|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `test:` | Adding or changing tests only |
| `docs:` | Documentation only |
| `chore:` | Setup, config, packages |

Small commits with clear messages are better than one giant "done" commit. They also show your
contribution.

### Step 5: Push your branch

```bash
git push -u origin feature/F-001-donor-registration
```

The `-u` is only needed the first time. After that, plain `git push` works.

### Step 6: Open a Pull Request

1. GitHub shows a yellow **"Compare & pull request"** button. Click it.
2. **Base:** `main` ← **compare:** your branch.
3. **Title:** e.g. `[F-001] Donor registration`
4. **Description:** what you did, how to test it, and the line `Closes #12` (use your issue's number).
   That line closes the issue automatically when the PR is merged.
5. Click **Create pull request**, then post `PR ready: <link>` in the group chat.

### Step 7: Review

- A teammate reviews the PR. **Yash (repo owner) merges.**
- If they ask for changes, make them on the **same branch**, then commit and push again. The PR updates
  itself.
- Once CI is set up, the tests must be green ✅ before merging.

### Step 8: After it's merged

```bash
git switch main
git pull
git branch -d feature/F-001-donor-registration
```

Check that your card moved to **Done** on the board.

### Getting teammates' merged work into your branch

If `main` has new work you need while your branch is still open:

```bash
git switch main
git pull
git switch feature/F-001-donor-registration
git merge main
```

---

## 6. Writing tests

The course checks for **unit tests** and **integration tests** that cover **normal, boundary and error
cases**.

| Type | Tests what | Where it goes | Example |
|---|---|---|---|
| **Unit test** | One function on its own, with no server or DB | `server/tests/unit/` | `isEligible({ age: 17 })` returns false |
| **Integration test** | A real request going through routes → service (→ DB) | `server/tests/integration/` | `POST /api/donors` returns `201` |
| **Client test** | A React component rendered in a simulated browser | `client/src/`, next to the component | The donor form shows an error for age 17 |

- Name server tests `<something>.test.js` and client tests `<Component>.test.jsx`. Jest and Vitest find
  them automatically.
- Running them:

```bash
# inside server/
npm test                   # all server tests
npm run test:unit          # only tests/unit
npm run test:integration   # only tests/integration (needs MySQL + npm run db:setup)

# inside client/
npm test                   # all client tests, once
npm run test:watch         # re-run on every save
```

- **Put the STP test case ID in the test name**, so we can show which test covers which requirement:

```js
describe('TC-Reg-02: donor eligibility', () => {
  it('rejects age 17 (boundary, below minimum)', () => { /* ... */ });
  it('accepts age 18 (boundary, minimum)', () => { /* ... */ });
  it('accepts age 65 (boundary, maximum)', () => { /* ... */ });
  it('rejects age 66 (boundary, above maximum)', () => { /* ... */ });
});
```

- **Boundary cases** are the values right at the edges of a rule: age 17/18/65/66, weight 44.9/45,
  days since last donation 89/90.
- For integration tests, use Supertest the same way `tests/integration/health.test.js` does:

```js
const request = require('supertest');
const app = require('../../src/app');

const res = await request(app).get('/api/health');
expect(res.status).toBe(200);
```

- For client tests, render the component and look for what the user sees, the same way
  `client/src/App.test.jsx` does:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('shows the page title', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Blood Bank Management System' }),
    ).toBeInTheDocument();
  });
});
```

  Use `@testing-library/user-event` to simulate typing and clicking.

---

## 7. The golden rules

1. **Never push to `main`.** Everything goes through a PR.
2. **Never commit `.env` or `node_modules/`.** Look at `git status` before every commit.
3. **Always branch from the latest `main`**, and never from a teammate's unmerged branch.
4. **One issue = one branch = one PR.** Keep PRs small, so they get reviewed in hours, not days.
5. **Always put `requireRole(...)` on routes**, even though it's a stub today.
6. **SQL only in `*.repository.js`, and always with `?` placeholders.**
7. **Use the status codes from the SAD** (section 4).
8. **Different from SRS/SAD/STP? Add a row to `DEVIATIONS.md`** with the date, the document and section,
   what changed and why. We must explain these at the demo.
9. **Found a bug?** Open a GitHub Issue with the `bug` label.
10. **Stuck for more than 20 minutes?** Ask in the group chat. Paste the exact error.

---

## 8. When something goes wrong

| Problem | What it means | Fix |
|---|---|---|
| `'jest' is not recognized` / `Cannot find module 'express'` | Packages not installed | `cd server` then `npm install` |
| `npm test` says "no tests found" | You're in the wrong folder | `cd server` first |
| `EADDRINUSE: address already in use :::4000` | Another server is already running on 4000 | Close the other terminal running `npm run dev`. Or find it: Windows `netstat -ano \| findstr :4000`, then `taskkill /PID <pid> /F`. Mac `lsof -i :4000`, then `kill <pid>` |
| `git push` rejected: "fetch first" / "non-fast-forward" | GitHub has commits you don't have | `git pull`, then `git push` again |
| `CONFLICT (content): Merge conflict in ...` | You and someone else changed the same lines | Open the file. Keep the right code between the `<<<<<<<`, `=======`, `>>>>>>>` markers, delete the markers, then `git add <file>` and `git commit`. Ask if unsure. |
| You committed to `main` by accident (not pushed yet) | — | `git switch -c feature/<name>` (your commit moves with you), then `git switch main` and `git reset --hard origin/main` |
| You staged `.env` or `node_modules` by accident | — | `git reset` (unstages everything, your files are kept) |
| You **committed** `.env` | — | `git rm --cached server/.env`, commit, and tell Yash. If it was pushed, change the passwords in it. |
| `requireRole` throws `Unknown role "..."` | Misspelt role | Use one of `DONOR`, `LAB_TECH`, `MANAGER`, `HOSPITAL`, `ADMIN` |
| Your commits don't show your GitHub profile picture | Wrong git email | See [2.2](#22-tell-git-who-you-are-once-per-laptop) |

---

## 9. Cheat sheet

```bash
# --- start of a new issue ---
git switch main
git pull
git switch -c feature/<id>-<short-name>

# --- while working (inside server/) ---
npm test                     # run tests
npm run dev                  # run API on http://localhost:4000 (auto-restarts on save)

# --- saving work ---
git status                   # check: no .env, no node_modules
git add <files>
git commit -m "feat(<module>): <what you did>"
git push                     # first time: git push -u origin <branch>

# --- then on GitHub ---
# open PR → "Closes #<issue>" → post link in group chat → review → merge

# --- after merge ---
git switch main
git pull
git branch -d feature/<id>-<short-name>
```
