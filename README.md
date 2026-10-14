# Mi'kmaq Language Learning Game - Software Engineering 2025

A collaborative full-stack software project developed as part of a software engineering course. The project is a **Mi'kmaq language-learning game designed for use by the community of Eskasoni, Nova Scotia**, providing an interactive way for users to practice and engage with the Mi'kmaq language.

The project applies software engineering practices throughout the **Software Development Life Cycle (SDLC)**, from requirements gathering and system design through implementation, testing, and continuous integration.

## Tech Stack

* **Languages:** TypeScript, JavaScript, CSS
* **Frontend:** React, Vite
* **Backend:** TypeScript API
* **Testing:** Cypress
* **Tooling:** Bun, TypeScript, Prettier
* **DevOps:** Docker, GitHub Actions
* **Version Control:** Git, GitHub

## Architecture

The project uses a **Bun workspace monorepo**, separating the application into frontend and backend packages while maintaining a unified development environment.

```text
.
├── packages/
│   ├── front-end/       # React/Vite frontend
│   └── api/             # Backend API
├── cypress/             # End-to-end tests
├── .github/workflows/   # CI/CD workflows
├── Dockerfile
├── cypress.config.ts
├── tsconfig.json
└── package.json
```

The architecture allows the frontend and backend to be developed independently while sharing project tooling, dependencies, and configuration.

---

# Software Engineering

The project emphasizes the application of software engineering principles to the development of a real-world educational application.

### Requirements & Planning

Requirements were gathered and translated into actionable development tasks based on the needs of the intended users and stakeholders. These requirements guided feature development and provided criteria for evaluating the completed software.

### Architecture & Design

The system was decomposed into separate frontend and backend packages, establishing clear responsibilities between the user interface and application logic.

### Team Development

Development was coordinated through **Git and GitHub**, using branches, commits, issues, and pull requests to manage work across the development team and integrate individual contributions.

### Testing & Quality Assurance

**Cypress** was used for end-to-end testing, while TypeScript provided static type checking. **Prettier** was used to maintain consistent code formatting throughout the project.

### CI/CD

**GitHub Actions** was used to automate development and integration checks, helping identify issues before changes were integrated into the shared codebase.

### Development Standards

The team established shared conventions for project structure, components, routes, utilities, variables, and other code elements. These standards helped maintain consistency across contributions and made the codebase easier to understand and maintain.

---

## Development Workflow

```text
Requirements
     ↓
Planning & Task Breakdown
     ↓
Implementation
     ↓
Testing & Type Checking
     ↓
Pull Request / Review
     ↓
CI Checks
     ↓
Integration
```

This project demonstrates practical experience with **requirements engineering, collaborative development, software architecture, version control, automated testing, CI/CD, and software maintenance** while developing software for a real community and educational context.
