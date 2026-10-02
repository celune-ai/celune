/**
 * Seeded memories for AI agent team roles and team templates.
 *
 * Two registries:
 * - ROLE_MEMORIES: per-role memories (8 roles × 6 each = 48)
 * - TEMPLATE_MEMORIES: per-template memories (26 templates × 10-12 each ≈ 300)
 */
import type { StarterMemory } from './starter-memories';

// ---------------------------------------------------------------------------
// ROLE MEMORIES (8 roles × 6 memories each)
// ---------------------------------------------------------------------------

export const ROLE_MEMORIES: Record<string, StarterMemory[]> = {
  // ── Team Lead (Helm) ──────────────────────────────────────────────────
  lead: [
    {
      key: 'role:lead:delegation',
      content:
        'Delegate by matching task complexity to agent capability. Assign stretch tasks to grow skills, but never put critical-path work on an unproven agent without a safety net.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'role:lead:prioritization',
      content:
        'Prioritize ruthlessly using impact vs effort. If everything is urgent, nothing is — force-rank the top 3 and sequence the rest.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:lead:sprint-planning',
      content:
        'Sprint planning should produce a clear, committed scope with explicit acceptance criteria. Leave 20% buffer for unplanned work and review velocity trends before committing.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:lead:team-coordination',
      content:
        'Reduce coordination overhead by establishing clear ownership boundaries. Use async status updates and reserve sync meetings for decisions that need real-time discussion.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:lead:conflict-resolution',
      content:
        'Address conflicts early by focusing on shared goals rather than positions. Reframe disagreements as design trade-offs with explicit criteria for resolution.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:lead:progress-tracking',
      content:
        'Track progress through deliverables, not activity. A task is either done (meets acceptance criteria) or not — avoid percentage-complete estimates that mask blockers.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Quality Reviewer (Quinn) ──────────────────────────────────────────
  reviewer: [
    {
      key: 'role:reviewer:review-checklists',
      content:
        'Use a structured checklist for every review: correctness, edge cases, security, performance, readability, and test coverage. Checklists prevent drift and ensure consistency.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:reviewer:quality-gates',
      content:
        'Quality gates must be binary pass/fail with documented criteria. Never approve with "looks fine" — cite the specific checks that passed.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'role:reviewer:security-review',
      content:
        'In every review, check for injection vectors, auth bypass, data exposure, and insecure defaults. Security issues block merging regardless of feature priority.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'role:reviewer:feedback-delivery',
      content:
        'Frame feedback as questions or suggestions, not commands. Distinguish blocking issues (must fix) from nits (optional). Be specific — cite the line and explain why.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:reviewer:regression-detection',
      content:
        'Compare every change against existing behavior. Look for removed tests, changed defaults, and altered error handling — these are the most common regression sources.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:reviewer:standards-enforcement',
      content:
        'Enforce standards through automation first (linters, formatters, CI checks). Reserve manual review bandwidth for logic, architecture, and UX decisions that tools cannot catch.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Project Manager (Atlas) ───────────────────────────────────────────
  pm: [
    {
      key: 'role:pm:spec-writing',
      content:
        'Every spec needs a problem statement, success criteria, scope boundaries, and open questions. A spec without explicit non-goals will inevitably creep.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:pm:roadmap-management',
      content:
        'Maintain a living roadmap with clear time horizons: committed (this sprint), planned (next 2 sprints), and exploratory (backlog). Re-evaluate quarterly.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:pm:stakeholder-communication',
      content:
        'Tailor updates to the audience: executives want outcomes and risks, engineers want blockers and decisions, customers want timelines and impact. One format does not fit all.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:pm:prioritization-frameworks',
      content:
        'Use RICE (Reach, Impact, Confidence, Effort) or weighted scoring to depersonalize prioritization debates. Document the rationale so decisions can be revisited.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:pm:scope-control',
      content:
        'Scope changes require an explicit trade-off: what gets cut or delayed to make room. Never add scope without adjusting timeline or resources.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'role:pm:milestone-tracking',
      content:
        'Define milestones as concrete deliverables, not dates. Track leading indicators (tasks completed, blockers resolved) to predict milestone health before deadlines arrive.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Designer (Pixel) ──────────────────────────────────────────────────
  designer: [
    {
      key: 'role:designer:design-system',
      content:
        'Maintain a single source of truth for design tokens, components, and patterns. Every new component should justify why an existing one cannot be extended.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:designer:user-research',
      content:
        'Validate assumptions with real users early and often. Five usability tests catch 85% of issues — do not wait for a large sample to start learning.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:designer:accessibility',
      content:
        'Design for accessibility from the start: sufficient color contrast (WCAG AA), keyboard navigation, screen reader labels, and focus indicators. Retrofitting is 10x more expensive.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'role:designer:responsive-design',
      content:
        'Design mobile-first, then progressively enhance for larger viewports. Test at real breakpoints (320px, 768px, 1024px, 1440px) — not just "desktop and mobile."',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:designer:design-critique',
      content:
        'In design critiques, separate aesthetic preferences from usability concerns. Ground feedback in user goals and established heuristics, not personal taste.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:designer:prototyping',
      content:
        'Match prototype fidelity to the question being answered. Use low-fi for flow validation, mid-fi for layout and hierarchy, high-fi only for visual polish and interaction details.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Researcher (Scout) ────────────────────────────────────────────────
  researcher: [
    {
      key: 'role:researcher:methodology',
      content:
        'Choose research methodology based on the question type: qualitative for "why" and "how," quantitative for "how many" and "how much." Mixed methods triangulate for confidence.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:researcher:source-evaluation',
      content:
        'Evaluate every source for recency, authority, methodology, and potential bias. Primary sources outweigh secondary; peer-reviewed outweighs opinion. Always note the evidence grade.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'role:researcher:synthesis',
      content:
        'Synthesize findings into actionable insights, not just summaries. Every research output should answer: "So what?" and "Now what?" for the decision-maker.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:researcher:evidence-grading',
      content:
        'Grade evidence on a clear scale: strong (replicated, peer-reviewed), moderate (single study, credible source), weak (anecdotal, opinion). Label every claim with its grade.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:researcher:competitive-analysis',
      content:
        'Structure competitive analysis around capabilities, pricing, positioning, and gaps. Focus on what competitors do well that we do not — blind spots matter more than confirmations.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:researcher:insight-extraction',
      content:
        'Extract insights by identifying patterns across multiple data points. A single data point is an observation; three or more converging signals form an insight worth acting on.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Writer (Quill) ────────────────────────────────────────────────────
  writer: [
    {
      key: 'role:writer:editorial-standards',
      content:
        'Maintain a style guide covering voice, tone, formatting, and terminology. Consistency builds trust — deviations should be intentional and documented.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:writer:audience-adaptation',
      content:
        'Adapt vocabulary, depth, and examples to the target audience. Technical audiences want precision; general audiences want clarity. Never write for "everyone."',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:writer:seo',
      content:
        'Write for humans first, then optimize for search. Target one primary keyword per page, use it in the title and first paragraph, and support it with semantically related terms.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:writer:tone-calibration',
      content:
        'Calibrate tone to context: authoritative for documentation, conversational for blog posts, empathetic for support content. Tone mismatches erode credibility.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:writer:content-structure',
      content:
        'Structure content with a clear hierarchy: lead with the key takeaway, support with evidence, close with a call to action. Use headings, bullets, and short paragraphs for scannability.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:writer:editing-ruthlessly',
      content:
        'Cut 20-30% on every editing pass. Remove filler words, redundant phrases, and hedging language. If a sentence adds no new information, delete it.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
  ],

  // ── Analyst (Axiom) ───────────────────────────────────────────────────
  analyst: [
    {
      key: 'role:analyst:data-analysis',
      content:
        'Start every analysis with a clear question and hypothesis. Exploratory analysis without a question produces noise, not insight.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:analyst:visualization',
      content:
        'Choose chart types based on the relationship being shown: bar for comparison, line for trends, scatter for correlation, pie only for parts-of-whole with few categories.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:analyst:metric-selection',
      content:
        'Select metrics that drive decisions, not vanity metrics. Every metric should have an owner, a target, and a defined action when it crosses a threshold.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'role:analyst:statistical-rigor',
      content:
        'Always check sample size, statistical significance, and confounding variables before drawing conclusions. Correlation is not causation — state assumptions explicitly.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:analyst:dashboard-design',
      content:
        'Design dashboards with a clear information hierarchy: KPIs at the top, supporting metrics below, drill-down details on demand. Limit to 5-7 metrics per view.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:analyst:reporting-cadence',
      content:
        'Match reporting cadence to decision cadence: daily for operational metrics, weekly for team health, monthly for strategic KPIs. Over-reporting causes alert fatigue.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Operations (Relay) ────────────────────────────────────────────────
  ops: [
    {
      key: 'role:ops:process-documentation',
      content:
        "Document processes as runbooks with step-by-step instructions, decision trees, and escalation paths. A process that only lives in one person's head is a single point of failure.",
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:ops:automation-criteria',
      content:
        'Automate tasks that are repetitive (>3x/week), error-prone, or time-sensitive. Calculate ROI before automating: automation cost must be recouped within 3 months.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'role:ops:incident-response',
      content:
        'Follow a structured incident response: detect, triage, mitigate, resolve, postmortem. Assign clear roles (incident commander, communicator, investigator) before the crisis hits.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'role:ops:vendor-management',
      content:
        'Evaluate vendors on reliability, support responsiveness, exit cost, and data portability — not just price. Lock-in risk is a hidden cost that compounds over time.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:ops:capacity-planning',
      content:
        'Plan capacity based on growth projections plus 30% headroom. Monitor utilization trends and set alerts at 70% to trigger scaling discussions before hitting limits.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'role:ops:sla-tracking',
      content:
        'Define SLAs with measurable targets (uptime, response time, resolution time), track them with dashboards, and review monthly. SLAs without measurement are promises without accountability.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
  ],
};

// ---------------------------------------------------------------------------
// TEMPLATE MEMORIES (26 templates × 10-12 memories each)
// ---------------------------------------------------------------------------

export const TEMPLATE_MEMORIES: Record<string, StarterMemory[]> = {
  // ══════════════════════════════════════════════════════════════════════
  // SOFTWARE (4)
  // ══════════════════════════════════════════════════════════════════════

  // ── Software Development ──────────────────────────────────────────────
  'software-development': [
    {
      key: 'template:software-development:git-flow',
      content:
        'Use a trunk-based or Git Flow branching strategy consistently. Feature branches should be short-lived (< 2 days) to minimize merge conflicts and integration risk.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:software-development:ci-cd',
      content:
        'CI/CD pipelines should run lint, type-check, test, and build on every push. Deploy to staging automatically; production deploys should require explicit approval.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:software-development:code-organization',
      content:
        'Organize code by feature or domain, not by file type. Colocation of related files (component, test, styles, types) reduces cognitive overhead and improves discoverability.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:software-development:api-design',
      content:
        'Design APIs contract-first: define the interface before implementation. Use consistent naming, versioning, and error formats. Breaking changes require a deprecation period.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:software-development:testing-pyramid',
      content:
        'Follow the testing pyramid: many unit tests (fast, isolated), fewer integration tests (API boundaries), minimal E2E tests (critical paths). Invert the pyramid and you get slow, flaky suites.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:software-development:dependency-management',
      content:
        'Pin dependency versions in lockfiles. Audit for vulnerabilities weekly. Evaluate new dependencies on maintenance health, bundle size, and API stability before adding them.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:software-development:refactoring',
      content:
        'Refactor in small, testable increments — never combine refactoring with feature changes in the same commit. Ensure tests pass before and after every refactoring step.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:software-development:deployment',
      content:
        'Deploy frequently in small batches to reduce risk. Use feature flags to decouple deployment from release. Always have a rollback plan tested before deploying.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:software-development:monitoring',
      content:
        'Instrument applications with structured logging, error tracking, and performance metrics from day one. You cannot debug what you cannot observe.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:software-development:documentation',
      content:
        'Document the "why" in code comments and the "how" in READMEs. Architecture decision records (ADRs) capture context that commit messages cannot.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Data Science ──────────────────────────────────────────────────────
  'data-science': [
    {
      key: 'template:data-science:experiment-tracking',
      content:
        'Log every experiment with hyperparameters, dataset version, metrics, and a reproducibility seed. Use tools like MLflow or W&B — manual tracking drifts within weeks.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:data-science:feature-engineering',
      content:
        'Feature engineering often matters more than model selection. Start with domain-informed features, validate with feature importance, and remove low-signal features to reduce overfitting.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:data-science:model-evaluation',
      content:
        'Evaluate models on held-out test sets that mirror production distribution. Report multiple metrics (precision, recall, F1, AUC) — a single accuracy number hides class imbalance issues.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:data-science:data-pipeline',
      content:
        'Build idempotent, versioned data pipelines. Every transformation should be reproducible from raw data. Schema validation at pipeline boundaries catches drift early.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:data-science:ab-testing',
      content:
        'Design A/B tests with a pre-registered hypothesis, minimum detectable effect, and required sample size. Never peek at results before the test reaches statistical power.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:data-science:notebook-hygiene',
      content:
        'Notebooks are for exploration, not production. Extract validated logic into versioned Python modules. Clean notebooks should run top-to-bottom without errors.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:data-science:reproducibility',
      content:
        'Pin library versions, fix random seeds, and version datasets. If an experiment cannot be reproduced by another team member, its results are unreliable.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:data-science:data-governance',
      content:
        'Classify data by sensitivity (public, internal, confidential, restricted). Apply access controls, retention policies, and audit logging appropriate to each classification.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:data-science:bias-detection',
      content:
        'Audit models for demographic bias across protected attributes before deployment. Use fairness metrics (equalized odds, demographic parity) and document trade-offs explicitly.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:data-science:stakeholder-translation',
      content:
        'Translate model results into business language: expected revenue impact, risk reduction, or time saved. Stakeholders do not need to understand the algorithm — they need to trust the outcome.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Cybersecurity ─────────────────────────────────────────────────────
  cybersecurity: [
    {
      key: 'template:cybersecurity:threat-modeling',
      content:
        'Threat model every new feature using STRIDE or PASTA before development begins. Identify trust boundaries, data flows, and attack surfaces — fixing threats in design costs 100x less than in production.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:cybersecurity:owasp-top-10',
      content:
        'Review every release against the current OWASP Top 10. Injection, broken auth, and sensitive data exposure remain the most exploited vulnerability classes year after year.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:cybersecurity:vulnerability-assessment',
      content:
        'Run automated vulnerability scans (SAST, DAST, SCA) in CI. Triage findings by exploitability and impact — not all CVEs are created equal. Critical + exploitable = immediate fix.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:cybersecurity:incident-response',
      content:
        'Maintain a tested incident response plan with clear roles, communication templates, and escalation paths. Run tabletop exercises quarterly — a plan untested is a plan that will fail.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:cybersecurity:security-testing',
      content:
        'Supplement automated scanning with manual penetration testing at least annually. Automated tools miss business logic flaws, authorization bypasses, and chained attack vectors.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:cybersecurity:compliance-frameworks',
      content:
        'Map security controls to relevant compliance frameworks (SOC 2, ISO 27001, GDPR). Maintain evidence continuously — audit preparation should be a byproduct of daily operations, not a fire drill.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:cybersecurity:access-control',
      content:
        'Enforce least-privilege access with role-based controls. Review permissions quarterly, remove stale accounts immediately, and require MFA for all privileged access.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:cybersecurity:logging-monitoring',
      content:
        'Log authentication events, authorization failures, data access, and admin actions. Centralize logs, set anomaly alerts, and retain for at least 90 days for forensic analysis.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:cybersecurity:security-awareness',
      content:
        'Train all team members on phishing, social engineering, and secure coding practices. The human layer is the most commonly exploited attack surface.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:cybersecurity:patch-management',
      content:
        'Establish a patch SLA: critical vulnerabilities within 24 hours, high within 7 days, medium within 30 days. Track patch compliance as a security KPI.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
  ],

  // ── DevOps ────────────────────────────────────────────────────────────
  devops: [
    {
      key: 'template:devops:infrastructure-as-code',
      content:
        'Define all infrastructure as code (Terraform, Pulumi, CloudFormation). Manual console changes create drift — if it is not in code, it does not exist.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:devops:ci-cd-pipelines',
      content:
        'Design CI/CD pipelines as code with clear stages: build, test, security scan, deploy to staging, integration test, deploy to production. Every stage should be independently retriable.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:devops:monitoring-alerting',
      content:
        'Implement the four golden signals: latency, traffic, errors, and saturation. Alert on symptoms (user impact), not causes — and set thresholds that minimize false positives.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:devops:container-orchestration',
      content:
        'Use health checks, resource limits, and graceful shutdown handlers for every container. Set pod disruption budgets and anti-affinity rules to maintain availability during updates.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:devops:secret-management',
      content:
        'Never store secrets in code, environment files, or container images. Use a secrets manager (Vault, AWS Secrets Manager) with rotation policies and audit logging.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:devops:disaster-recovery',
      content:
        'Define RTO and RPO for every service. Test disaster recovery procedures quarterly with real failovers — an untested backup is not a backup.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:devops:capacity-planning',
      content:
        'Monitor resource utilization trends and project growth. Scale proactively at 70% utilization — reactive scaling during traffic spikes causes outages.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:devops:sre-practices',
      content:
        'Define error budgets based on SLOs. When the error budget is exhausted, freeze feature releases and focus on reliability. This aligns incentives between velocity and stability.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:devops:cost-optimization',
      content:
        'Tag all cloud resources by team and service. Review cost reports weekly, right-size instances monthly, and use reserved/spot instances for predictable workloads.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:devops:runbook-creation',
      content:
        'Write runbooks for every alert: symptoms, diagnosis steps, mitigation actions, and escalation criteria. A runbook should enable any on-call engineer to resolve the issue without tribal knowledge.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
  ],

  // ══════════════════════════════════════════════════════════════════════
  // MARKETING (1)
  // ══════════════════════════════════════════════════════════════════════

  // ── Growth Marketing ──────────────────────────────────────────────────
  'growth-marketing': [
    {
      key: 'template:growth-marketing:acquisition-channels',
      content:
        'Test acquisition channels with small budgets before scaling. Measure CAC per channel and compare to LTV. A channel is only viable if LTV/CAC > 3.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:growth-marketing:conversion-optimization',
      content:
        'Optimize conversion funnels one step at a time, starting from the bottom. A 10% improvement at checkout compounds more than a 10% improvement at awareness.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:growth-marketing:cohort-analysis',
      content:
        'Analyze user behavior by cohort (signup week/month) to distinguish true trends from mix effects. Aggregate metrics hide retention decay and feature adoption patterns.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:growth-marketing:attribution-modeling',
      content:
        'Use multi-touch attribution to understand the full conversion path. Last-click attribution over-credits bottom-funnel channels and under-credits awareness efforts.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:growth-marketing:growth-loops',
      content:
        'Build growth loops where output from one cycle feeds input to the next: user creates content, content attracts new users, new users create more content. Loops compound; funnels do not.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:growth-marketing:retention-tactics',
      content:
        'Retention is the most important growth lever. Measure Day 1, Day 7, and Day 30 retention separately. Activation (first value moment) is the biggest predictor of long-term retention.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:growth-marketing:viral-mechanics',
      content:
        'Design viral mechanics that add user value, not just distribution. Invites that help the sender (shared workspaces, referral rewards) convert better than pure "invite a friend" prompts.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:growth-marketing:landing-page-optimization',
      content:
        'Every landing page needs one clear CTA, a value proposition above the fold, and social proof. Test headlines first — they drive the largest conversion variance.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:growth-marketing:email-marketing',
      content:
        'Segment email lists by behavior, not just demographics. Triggered emails (welcome, activation, re-engagement) outperform batch sends by 3-5x in open and click rates.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:growth-marketing:social-media-strategy',
      content:
        'Focus on 2-3 social platforms where your audience actually lives. Consistency beats virality — post regularly, engage authentically, and measure engagement rate over follower count.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:growth-marketing:brand-voice-consistency',
      content:
        'Define your brand voice with 3-4 adjectives (e.g., "confident, approachable, witty, technical"). Create a voice & tone guide with do/don\'t examples. Every agent should reference it before generating customer-facing copy. Voice stays constant; tone adapts to context (support = empathetic, marketing = energetic).',
      category: 'preference',
      memory_type: 'preference',
      importance_score: 0.85,
    },
    {
      key: 'template:growth-marketing:content-repurposing',
      content:
        'Repurpose every piece of high-effort content into 5+ formats: blog post → LinkedIn carousel → Twitter thread → newsletter section → video script → podcast talking points. Create once, distribute everywhere. Track which derivative format drives the most engagement per channel.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:growth-marketing:experiment-velocity',
      content:
        'Run at least 2-3 marketing experiments per week. Use the ICE framework (Impact × Confidence × Ease) to prioritize. Document every experiment with hypothesis, variant, metric, result, and learning — even failed experiments generate knowledge.',
      category: 'decision',
      memory_type: 'decision',
      importance_score: 0.85,
    },
  ],

  // ══════════════════════════════════════════════════════════════════════
  // CONTENT (1)
  // ══════════════════════════════════════════════════════════════════════

  // ── Content Studio ────────────────────────────────────────────────────
  'content-studio': [
    {
      key: 'template:content-studio:editorial-calendar',
      content:
        'Maintain a rolling 4-week editorial calendar with themes, deadlines, and owners. Plan quarterly themes but allow 20% flexibility for timely/reactive content.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:content-studio:content-pillars',
      content:
        'Define 3-5 content pillars that align with business goals and audience needs. Every piece of content should map to a pillar — if it does not fit, it dilutes your positioning.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:content-studio:distribution-strategy',
      content:
        'Spend as much effort on distribution as creation. Publish once, distribute everywhere: blog to newsletter to social to community. Each channel needs native formatting.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:content-studio:content-repurposing',
      content:
        'Repurpose high-performing content across formats: blog post to Twitter thread to LinkedIn carousel to short video. One idea, five formats, five touchpoints.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:content-studio:podcast-production',
      content:
        'Batch record podcast episodes 2-3 at a time. Prepare structured outlines (not scripts) to maintain natural conversation. Post-production should follow a repeatable checklist.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.7,
    },
    {
      key: 'template:content-studio:newsletter-strategy',
      content:
        'Newsletters should deliver unique value not available elsewhere — curated insights, original analysis, or exclusive updates. Optimize for reply rate, not just open rate.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:content-studio:community-building',
      content:
        'Build community by facilitating member-to-member connections, not just brand-to-member broadcasts. Highlight user contributions and create rituals (weekly threads, AMAs).',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:content-studio:content-analytics',
      content:
        'Track content performance by funnel stage: awareness (impressions, reach), engagement (time on page, shares), and conversion (signups, leads). Optimize for the metric that matches your current goal.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:content-studio:brand-voice-guide',
      content:
        "Document brand voice with do/don't examples across tones (informative, playful, urgent). Every content creator should produce work that sounds like the same brand.",
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:content-studio:visual-storytelling',
      content:
        'Use visuals to explain, not just decorate. Diagrams, screenshots, and infographics should carry information that text alone cannot. Alt text is required for accessibility.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ══════════════════════════════════════════════════════════════════════
  // BUSINESS (4)
  // ══════════════════════════════════════════════════════════════════════

  // ── Startup Ops ───────────────────────────────────────────────────────
  'startup-ops': [
    {
      key: 'template:startup-ops:lean-methodology',
      content:
        'Build-Measure-Learn as fast as possible. The goal is validated learning, not shipping features. If you are not embarrassed by v1, you shipped too late.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:startup-ops:mvp-validation',
      content:
        'Define MVP as the smallest thing that tests your riskiest assumption. An MVP that tries to do everything validates nothing. Ship it in days, not months.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:startup-ops:fundraising',
      content:
        'Raise when you have leverage (traction, revenue, strong signal), not when you need money. Target 18-24 months of runway per round. Build relationships with investors before you need them.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:startup-ops:burn-rate',
      content:
        'Track burn rate weekly and maintain a cash-out date dashboard visible to leadership. Default alive means revenue growth outpaces expense growth — monitor the gap.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:startup-ops:product-market-fit',
      content:
        'Product-market fit is when users pull the product from you: organic growth, high retention, vocal advocates. The Sean Ellis test (40%+ "very disappointed" if gone) is a useful signal.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:startup-ops:hiring-strategy',
      content:
        'Hire generalists early (first 10 hires) and specialists later. Every early hire should be someone you would want to work with at 3 AM debugging production.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:startup-ops:board-communication',
      content:
        'Send monthly investor updates: key metrics, wins, challenges, asks. Transparency builds trust. Bad news shared early is a problem; bad news discovered late is a crisis.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:startup-ops:culture-building',
      content:
        'Culture is what you do, not what you say. Reinforce values through hiring decisions, promotions, and how you handle mistakes. Written values mean nothing without visible behavior.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:startup-ops:pivoting-signals',
      content:
        'Pivot signals: flat retention despite iteration, consistently negative unit economics, team energy drops. A pivot is not failure — it is applying what you learned to a better opportunity.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:startup-ops:legal-foundations',
      content:
        'Set up legal foundations early: incorporation, IP assignment, vesting agreements, and terms of service. Fixing legal gaps during due diligence is expensive and delays deals.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Sales ─────────────────────────────────────────────────────────────
  sales: [
    {
      key: 'template:sales:pipeline-management',
      content:
        'Maintain a clean pipeline with defined stages, entry criteria, and expected conversion rates. Remove stale deals ruthlessly — a bloated pipeline hides bad forecasts.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:sales:discovery-calls',
      content:
        "Discovery calls should be 70% listening, 30% talking. Understand the prospect's pain, urgency, decision process, and budget before presenting any solution.",
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:sales:objection-handling',
      content:
        'Handle objections by acknowledging, questioning deeper, and reframing. Most objections are symptoms of an unaddressed concern — find the root cause before countering.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:sales:pricing-strategy',
      content:
        'Price based on value delivered, not cost incurred. Anchor with a higher tier, present three options, and make the middle option the most attractive.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:sales:crm-hygiene',
      content:
        'Update CRM records after every interaction — a CRM is only as valuable as its data. Enforce required fields at stage transitions and audit data quality monthly.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:sales:forecasting',
      content:
        'Forecast based on weighted pipeline (deal value x probability by stage), not gut feel. Track forecast accuracy monthly and adjust stage probabilities with real conversion data.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:sales:account-management',
      content:
        'Existing customers are the highest-value growth lever. Schedule quarterly business reviews, track health scores, and proactively surface expansion opportunities before renewal.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:sales:competitive-positioning',
      content:
        'Position against competitors on your strengths, not their weaknesses. Build battle cards with talk tracks for the top 3 competitors and update them quarterly.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:sales:demo-best-practices',
      content:
        "Tailor every demo to the prospect's stated pain points — never run a generic feature tour. Show the outcome they want within the first 5 minutes, then go deeper.",
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:sales:follow-up-cadence',
      content:
        'Follow up within 24 hours of every meeting with a summary and next steps. Use a multi-touch cadence (email, call, social) with decreasing frequency over 3 weeks.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Finance ───────────────────────────────────────────────────────────
  finance: [
    {
      key: 'template:finance:financial-modeling',
      content:
        'Build financial models with clear assumptions, sensitivity tables, and scenario analysis (base, bull, bear). Models are tools for thinking, not predictions — label uncertainty explicitly.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:finance:budgeting',
      content:
        'Zero-base budgets annually and review monthly against actuals. Variance analysis should explain the "why" behind every significant deviation, not just flag the number.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:finance:cash-flow-management',
      content:
        'Cash flow forecasting matters more than P&L for survival. Maintain a 13-week rolling cash flow forecast and monitor weekly. Cash-positive operations are the ultimate moat.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:finance:unit-economics',
      content:
        'Track unit economics (CAC, LTV, payback period, gross margin) by cohort and channel. Aggregate unit economics hide unprofitable segments that drag down the business.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:finance:revenue-recognition',
      content:
        'Follow ASC 606 for revenue recognition: identify the contract, performance obligations, transaction price, allocation, and recognition timing. Get this wrong and audits become painful.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:finance:tax-planning',
      content:
        'Plan taxes proactively with quarterly estimated payments. Track R&D tax credits, state nexus obligations, and international tax implications. Engage a tax advisor before year-end.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:finance:audit-preparation',
      content:
        'Maintain audit-ready books year-round: reconcile monthly, document unusual transactions, and keep supporting evidence organized. Audit prep should be a formality, not a scramble.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:finance:investor-reporting',
      content:
        'Report to investors monthly with consistent KPIs: revenue, burn rate, runway, key metrics, and narrative context. Consistency in format builds credibility over time.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:finance:cost-allocation',
      content:
        'Allocate costs to departments and products using activity-based costing. Accurate cost allocation reveals true profitability and prevents cross-subsidization blind spots.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:finance:financial-controls',
      content:
        'Implement segregation of duties, approval workflows, and spending limits. Every dollar spent should have an owner, a budget line, and an approval trail.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
  ],

  // ── Business Development ──────────────────────────────────────────────
  'business-development': [
    {
      key: 'template:business-development:partnership-frameworks',
      content:
        'Evaluate partnerships on strategic alignment, resource commitment, and mutual benefit. The best partnerships create value neither party could generate alone.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:business-development:deal-structuring',
      content:
        'Structure deals with clear deliverables, timelines, revenue sharing, and exit clauses. Ambiguous terms cause disputes — over-specify rather than under-specify.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:business-development:market-entry',
      content:
        'Enter new markets with a beachhead strategy: dominate one niche segment before expanding. Validate demand with low-cost experiments before committing resources.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:business-development:strategic-alliances',
      content:
        'Strategic alliances need executive sponsors, joint KPIs, and regular check-ins to stay alive. Without active management, alliances decay into press releases without results.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:business-development:channel-partnerships',
      content:
        'Enable channel partners with training, co-branded materials, deal registration, and margin incentives. Partners sell what is easy to sell and profitable to deliver.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:business-development:contract-negotiation',
      content:
        'Negotiate from interests, not positions. Identify your BATNA (best alternative) before entering negotiations and never reveal your bottom line. Create value before claiming it.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:business-development:roi-modeling',
      content:
        'Build ROI models for every partnership with conservative assumptions. Include opportunity cost, ramp time, and management overhead — not just direct revenue.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:business-development:relationship-management',
      content:
        'Maintain a relationship map of key contacts at target partners and clients. Nurture relationships before you need them — warm intros convert 10x better than cold outreach.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:business-development:ecosystem-mapping',
      content:
        'Map the ecosystem of players (competitors, complementors, platforms, regulators) and identify where you fit. The strongest position is being the connector between ecosystem layers.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:business-development:co-marketing',
      content:
        'Co-marketing works when both audiences overlap but do not compete. Define shared goals, contribution split, and lead routing before creating any joint content.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.7,
    },
  ],

  // ══════════════════════════════════════════════════════════════════════
  // CREATIVE (3)
  // ══════════════════════════════════════════════════════════════════════

  // ── Design Studio ─────────────────────────────────────────────────────
  'design-studio': [
    {
      key: 'template:design-studio:design-tokens',
      content:
        'Define design tokens (colors, spacing, typography, shadows) as the single source of truth. Tokens bridge design and code — changes propagate automatically across all components.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:design-studio:component-library',
      content:
        'Build a component library with documented props, states, and usage guidelines. Components without documentation are components that get reinvented.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:design-studio:user-testing',
      content:
        'Test with 5 users per round, iterate, and test again. Observe behavior — what users do reveals more than what they say. Record sessions for team review.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:design-studio:responsive-design',
      content:
        'Design fluid layouts using relative units and CSS grid/flexbox. Test on real devices, not just browser resize. Thumb zones matter on mobile — keep primary actions within reach.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:design-studio:animation-principles',
      content:
        'Use animation to communicate state changes, guide attention, and reinforce spatial relationships. Keep durations under 300ms for UI transitions. Motion should feel purposeful, never decorative.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:design-studio:icon-design',
      content:
        'Design icons on a consistent grid (24px base) with uniform stroke width and corner radius. Icons should be recognizable at small sizes — test at 16px before finalizing.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.7,
    },
    {
      key: 'template:design-studio:color-theory',
      content:
        'Build palettes with 1 primary, 1 secondary, and 2-3 neutral tones plus semantic colors (success, warning, error, info). Ensure 4.5:1 contrast ratio for text on every background.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:design-studio:typography-scale',
      content:
        'Use a modular type scale (1.25 or 1.333 ratio) for visual hierarchy. Limit to 2 font families maximum. Line height should be 1.4-1.6 for body text and 1.1-1.3 for headings.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:design-studio:design-handoff',
      content:
        'Design handoff should include specs, interactive prototypes, asset exports, and annotated edge cases. Developers should never have to guess spacing, states, or behavior.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:design-studio:design-qa',
      content:
        'QA every implementation against the design at each breakpoint. Check spacing, typography, color, interaction states (hover, focus, active, disabled), and loading/error/empty states.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
  ],

  // ── Video Production ──────────────────────────────────────────────────
  'video-production': [
    {
      key: 'template:video-production:pre-production',
      content:
        'Pre-production is where videos are won or lost. Create a shot list, storyboard key scenes, scout locations, and confirm all logistics before the shoot day.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:video-production:script-formatting',
      content:
        'Format scripts with visual on the left and audio on the right (two-column format). Include timing estimates, transitions, and B-roll suggestions for the editor.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:video-production:shot-composition',
      content:
        'Follow the rule of thirds for framing. Vary shot types (wide, medium, close-up) to maintain visual interest. Every shot should serve a purpose — if it does not advance the story, cut it.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:video-production:lighting-setup',
      content:
        'Start with three-point lighting (key, fill, back) and adjust from there. Natural light is free but unpredictable — always have backup lighting. Expose for skin tones.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:video-production:audio-recording',
      content:
        'Audio quality matters more than video quality — viewers tolerate bad video but not bad audio. Use lavalier mics for interviews, boom mics for scenes, and always record room tone.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:video-production:editing-workflow',
      content:
        'Edit in passes: rough cut (structure), fine cut (timing), polish (graphics, color, audio). Organize media into bins by type and scene before starting the timeline.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:video-production:color-grading',
      content:
        'Color correct first (white balance, exposure), then color grade for mood. Use LUTs as starting points, not final looks. Maintain consistency across scenes.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:video-production:motion-graphics',
      content:
        'Motion graphics should enhance understanding, not distract. Use consistent animation language (easing, duration, style) across all graphics. Less is more.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.7,
    },
    {
      key: 'template:video-production:export-settings',
      content:
        'Export a master file at the highest quality (ProRes or DNxHR), then create platform-specific versions. YouTube: H.264, 1080p minimum, 8-12 Mbps. Social: match aspect ratio to platform.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:video-production:platform-optimization',
      content:
        'Optimize for each platform: hook in the first 3 seconds, add captions (80% watch muted on social), and match the native aspect ratio (16:9 YouTube, 9:16 Reels/TikTok, 1:1 feed).',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
  ],

  // ── Music Production ──────────────────────────────────────────────────
  'music-production': [
    {
      key: 'template:music-production:daw-workflow',
      content:
        'Organize DAW sessions with consistent color coding, track naming, and bus routing from the start. A clean session at bar 1 saves hours at bar 200.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:music-production:mixing-fundamentals',
      content:
        'Mix in mono first to check balance, then widen. Start with levels and panning before reaching for EQ and compression. If it does not sound good raw, no plugin will save it.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:music-production:mastering-chain',
      content:
        'A mastering chain typically flows: EQ, compression, saturation, stereo imaging, limiting. Target -14 LUFS for streaming, -10 LUFS for club tracks. Leave headroom (-1 dBTP).',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:music-production:arrangement-structure',
      content:
        'Structure arrangements with tension and release: intro, build, drop/chorus, breakdown, second build, final chorus, outro. Every section should earn its place — if it drags, cut it.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:music-production:sound-design',
      content:
        'Layer sounds for depth: a sub for low end, a mid-range element for body, a top layer for air. Process each layer independently before combining.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:music-production:sample-management',
      content:
        'Organize samples in a tagged library by type (kick, snare, pad, vocal), key, BPM, and genre. Back up the library and version it. Losing samples mid-project is devastating.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:music-production:collaboration-protocol',
      content:
        'When collaborating, agree on BPM, key, DAW project format, and file naming conventions upfront. Share stems (not just bounces) and keep a version log of all iterations.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:music-production:reference-tracking',
      content:
        'A/B against reference tracks throughout mixing and mastering. Match loudness before comparing. Reference tracks prevent ear fatigue from skewing your perception.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:music-production:release-preparation',
      content:
        'Prepare releases with ISRC codes, metadata (artist, title, genre, BPM), cover art (3000x3000 minimum), and distributor submission at least 4 weeks before release date.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:music-production:stem-organization',
      content:
        'Export stems in groups (drums, bass, synths, vocals, FX) at the same start point and sample rate. Label clearly with BPM and key. Stems are your insurance policy for future remixes.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ══════════════════════════════════════════════════════════════════════
  // OPERATIONS (2)
  // ══════════════════════════════════════════════════════════════════════

  // ── Recruitment ───────────────────────────────────────────────────────
  recruitment: [
    {
      key: 'template:recruitment:job-description',
      content:
        'Write job descriptions with clear outcomes (not just responsibilities), required vs nice-to-have skills, salary range, and team context. Vague JDs attract vague candidates.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:recruitment:sourcing-strategy',
      content:
        'Diversify sourcing channels: job boards for volume, LinkedIn for targeted outreach, referrals for quality, communities for passive candidates. Track cost-per-hire per channel.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:recruitment:interview-design',
      content:
        'Use structured interviews with standardized questions and scoring rubrics. Each interview round should assess different competencies to minimize redundancy and bias.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:recruitment:candidate-evaluation',
      content:
        'Evaluate candidates on demonstrated skills and potential, not pedigree. Use work samples and practical exercises over abstract brainteasers. Debrief as a group with independent scorecards.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:recruitment:offer-negotiation',
      content:
        'Make competitive first offers to avoid adversarial negotiations. Be transparent about compensation philosophy. Non-salary levers (equity, flexibility, growth) often matter more than base pay.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:recruitment:employer-branding',
      content:
        'Employer brand is built by current employees, not marketing. Showcase real team culture, project stories, and growth opportunities. Candidates research your Glassdoor and LinkedIn before applying.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:recruitment:pipeline-metrics',
      content:
        'Track time-to-fill, pass-through rates per stage, offer acceptance rate, and source quality. Bottlenecks in the pipeline reveal process problems — measure to improve.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:recruitment:diversity-hiring',
      content:
        'Build diversity into the pipeline, not just the shortlist. Expand sourcing to underrepresented communities, remove biased language from JDs, and use blind resume screening.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:recruitment:onboarding-design',
      content:
        'Design a 30-60-90 day onboarding plan with clear milestones, a dedicated buddy, and regular check-ins. The first 90 days determine long-term retention and productivity.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:recruitment:ats-optimization',
      content:
        'Configure ATS workflows to automate scheduling, status updates, and rejection emails. Candidate experience suffers most from communication gaps — automate the basics.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── HR Operations ─────────────────────────────────────────────────────
  'hr-operations': [
    {
      key: 'template:hr-operations:policy-documentation',
      content:
        'Document all HR policies in a searchable, version-controlled handbook. Policies should be written in plain language with examples. Review and update annually.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:hr-operations:performance-reviews',
      content:
        'Performance reviews should be continuous, not annual surprises. Use a lightweight framework (OKRs, competency rubrics) and separate development conversations from compensation decisions.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:hr-operations:compensation-benchmarking',
      content:
        'Benchmark compensation against market data by role, level, and geography. Review bands annually and adjust for market movement. Pay equity audits prevent systemic disparities.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:hr-operations:compliance-tracking',
      content:
        'Track compliance deadlines (labor law postings, training requirements, filing dates) in a calendar with automated reminders. Non-compliance penalties are avoidable and embarrassing.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:hr-operations:benefits-administration',
      content:
        'Survey employees annually on benefits satisfaction and usage. Optimize the benefits mix for your demographic — what matters to a 25-year-old engineer differs from a 40-year-old manager.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:hr-operations:employee-engagement',
      content:
        'Measure engagement with pulse surveys (monthly, 5 questions max) and act on the results visibly. Survey fatigue comes from surveying without action, not from surveying too often.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:hr-operations:conflict-resolution',
      content:
        'Address workplace conflicts early with a structured process: listen to both sides separately, identify the root cause, facilitate a resolution, and document the outcome.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:hr-operations:training-programs',
      content:
        'Design training with clear learning objectives, practical exercises, and follow-up assessments. Measure training ROI through behavior change on the job, not just satisfaction scores.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:hr-operations:offboarding',
      content:
        'Offboarding should be as structured as onboarding: exit interview, knowledge transfer, access revocation, asset return, and alumni network invitation. Departing employees become brand ambassadors or detractors.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:hr-operations:culture-initiatives',
      content:
        'Culture is reinforced through rituals: all-hands meetings, team retrospectives, recognition programs, and social events. Budget for culture like any other business function.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ══════════════════════════════════════════════════════════════════════
  // PROFESSIONAL SERVICES (3)
  // ══════════════════════════════════════════════════════════════════════

  // ── Legal ─────────────────────────────────────────────────────────────
  legal: [
    {
      key: 'template:legal:contract-review',
      content:
        'Review contracts with a checklist: parties, scope, payment terms, IP ownership, liability caps, termination clauses, governing law, and dispute resolution. Never skip the boilerplate.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:legal:ip-protection',
      content:
        'Protect IP proactively: file trademarks for brand names, use copyright notices, require IP assignment from contractors, and keep trade secrets documented and access-controlled.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:legal:regulatory-compliance',
      content:
        'Map applicable regulations by jurisdiction and business activity. Maintain a compliance matrix with responsible owners and audit dates. Regulatory changes require proactive monitoring.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:legal:risk-assessment',
      content:
        'Assess legal risks on likelihood and impact. High-likelihood, high-impact risks need immediate mitigation. Document risk acceptance decisions with the business rationale.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:legal:ndas',
      content:
        'Use mutual NDAs as the default for business discussions. Define confidential information specifically, set reasonable time limits (2-3 years), and include carve-outs for independently developed information.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:legal:terms-of-service',
      content:
        'Draft terms of service that balance legal protection with user readability. Cover acceptable use, liability limitations, data handling, and termination rights. Update when features change materially.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:legal:privacy-policy',
      content:
        'Privacy policies must accurately describe data collection, usage, sharing, and retention practices. GDPR requires specific lawful bases; CCPA requires opt-out mechanisms. Keep updated with actual practices.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:legal:dispute-resolution',
      content:
        'Prefer arbitration clauses for commercial disputes (faster, private). Include escalation paths: negotiation, then mediation, then arbitration. Litigation should be the last resort.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:legal:legal-research',
      content:
        'Verify legal research with primary sources (statutes, case law, regulations). Secondary sources (articles, summaries) provide context but are not authoritative. Always check for recent amendments.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:legal:document-management',
      content:
        'Maintain a centralized, version-controlled contract repository with execution dates, renewal dates, and key terms indexed. Contracts you cannot find are contracts you cannot enforce.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Consulting ────────────────────────────────────────────────────────
  consulting: [
    {
      key: 'template:consulting:client-discovery',
      content:
        'Start every engagement with structured discovery: business context, stakeholders, constraints, success metrics, and political dynamics. The presenting problem is rarely the real problem.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:consulting:framework-application',
      content:
        "Use frameworks (MECE, Porter's Five Forces, value chain) as thinking tools, not answers. Adapt frameworks to the specific situation — forcing a framework creates blind spots.",
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:consulting:deliverable-structuring',
      content:
        'Structure deliverables with the pyramid principle: lead with the recommendation, support with key arguments, back with evidence. Executives read top-down — bury the answer and they miss it.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:consulting:workshop-facilitation',
      content:
        'Design workshops with clear objectives, timed exercises, and tangible outputs. Facilitation means guiding the group to their own insights — resist the temptation to lecture.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:consulting:change-management',
      content:
        'Change management requires addressing three layers: processes (how work gets done), tools (what people use), and mindsets (why people resist). Ignoring any layer causes the change to fail.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:consulting:executive-presentations',
      content:
        'Executive presentations should be 10 slides maximum: situation, complication, resolution, evidence, risks, next steps. Rehearse to half the allocated time — discussion always expands.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:consulting:sow-writing',
      content:
        'Write SOWs with explicit scope, deliverables, timeline, assumptions, and change order process. Ambiguous SOWs lead to scope creep and unhappy clients. Over-specify rather than under-specify.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:consulting:value-quantification',
      content:
        'Quantify the value of recommendations in client terms: revenue gained, cost reduced, risk mitigated, time saved. Abstract recommendations without numbers do not get funded.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:consulting:knowledge-management',
      content:
        'Capture project learnings in a searchable knowledge base: methodologies used, client context, outcomes, and reusable templates. Institutional knowledge walks out the door without systems.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:consulting:capacity-utilization',
      content:
        'Target 70-80% utilization for consultants — 100% means no time for business development, training, or innovation. Track billable vs non-billable hours and optimize the mix.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Healthcare Ops ────────────────────────────────────────────────────
  'healthcare-ops': [
    {
      key: 'template:healthcare-ops:hipaa-compliance',
      content:
        'HIPAA compliance requires administrative, physical, and technical safeguards for PHI. Conduct risk assessments annually, train all staff, and maintain Business Associate Agreements with every vendor handling PHI.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:healthcare-ops:clinical-workflow',
      content:
        'Design clinical workflows to minimize cognitive load on providers. Standardize order sets, automate routine documentation, and surface decision support at the point of care.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:healthcare-ops:care-coordination',
      content:
        'Effective care coordination requires shared care plans, clear handoff protocols, and closed-loop communication between providers. Gaps in coordination cause adverse events.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:healthcare-ops:quality-metrics',
      content:
        'Track quality metrics aligned with CMS and accreditation standards: readmission rates, patient safety indicators, clinical outcomes, and process measures. Benchmark against national data.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:healthcare-ops:regulatory-compliance',
      content:
        'Maintain compliance with CMS, Joint Commission, state licensing, and payer requirements. Use a compliance calendar with automated alerts for deadlines, surveys, and reporting periods.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:healthcare-ops:staff-scheduling',
      content:
        'Schedule staff based on patient volume patterns, acuity levels, and skill mix requirements. Overtime should be the exception — chronic overtime signals a staffing or process problem.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:healthcare-ops:inventory-management',
      content:
        'Implement PAR levels for clinical supplies, automate reorder points, and track expiration dates. Stockouts disrupt patient care; overstocking wastes budget and storage.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:healthcare-ops:telehealth-operations',
      content:
        'Design telehealth workflows with the same rigor as in-person visits: scheduling, intake, documentation, prescribing, and follow-up. Ensure platform compliance with HIPAA and state licensure requirements.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:healthcare-ops:documentation-standards',
      content:
        'Clinical documentation must be timely, accurate, complete, and legible. Use templates for consistency but allow free-text for clinical reasoning. Documentation drives coding, billing, and continuity of care.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:healthcare-ops:patient-satisfaction',
      content:
        'Measure patient satisfaction with CAHPS-aligned surveys and track response rates by department. Service recovery within 24 hours of a complaint converts detractors into promoters.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ══════════════════════════════════════════════════════════════════════
  // PERSONAL (4)
  // ══════════════════════════════════════════════════════════════════════

  // ── Personal Productivity ─────────────────────────────────────────────
  'personal-productivity': [
    {
      key: 'template:personal-productivity:time-blocking',
      content:
        'Block time for deep work in 90-minute sessions with breaks. Protect these blocks like meetings — context switching costs 23 minutes of recovery per interruption.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:personal-productivity:inbox-zero',
      content:
        "Process email to zero by deciding on each message once: respond (< 2 min), delegate, defer to a task list, or archive. Email is other people's priorities — do not let it set yours.",
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:personal-productivity:weekly-review',
      content:
        "Conduct a weekly review every Friday: clear inboxes, review calendar, update task lists, and plan next week's priorities. The review is the keystone habit that keeps everything else working.",
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:personal-productivity:energy-management',
      content:
        'Schedule your most important work during your peak energy hours. Track energy patterns for a week to identify your natural rhythm. Protect high-energy slots for creative and strategic work.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:personal-productivity:focus-techniques',
      content:
        'Use the Pomodoro technique (25 min focus + 5 min break) for tasks you are resisting. Remove distractions proactively: close tabs, silence notifications, use website blockers.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:personal-productivity:delegation-rules',
      content:
        'Delegate tasks that someone else can do 80% as well as you. Provide context and success criteria, not step-by-step instructions. Check in at milestones, not constantly.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:personal-productivity:meeting-hygiene',
      content:
        'Every meeting needs an agenda, a facilitator, and a documented outcome. Default to 25-minute meetings. If a meeting can be an email, make it an email.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:personal-productivity:digital-organization',
      content:
        'Use a consistent naming convention and folder structure across all digital tools. If you spend more than 30 seconds finding a file, your system needs reorganization.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.7,
    },
    {
      key: 'template:personal-productivity:batch-processing',
      content:
        'Batch similar tasks together: email processing, phone calls, administrative work, and errands. Batching reduces context-switching overhead and builds momentum.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:personal-productivity:decision-fatigue',
      content:
        'Reduce decision fatigue by automating routine choices: meal prep, standard wardrobe, default meeting times. Save decision energy for high-stakes choices that actually matter.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Learning ──────────────────────────────────────────────────────────
  learning: [
    {
      key: 'template:learning:spaced-repetition',
      content:
        'Use spaced repetition to move knowledge into long-term memory. Review at increasing intervals: 1 day, 3 days, 7 days, 21 days, 60 days. Tools like Anki automate the scheduling.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:learning:active-recall',
      content:
        'Active recall (testing yourself) is 2-3x more effective than passive review (re-reading). After studying, close the book and write down everything you remember.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:learning:feynman-technique',
      content:
        'Explain concepts in simple language as if teaching a beginner. When you get stuck, you have found your knowledge gap. Go back to the source, fill the gap, and simplify again.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:learning:learning-journal',
      content:
        'Maintain a learning journal with daily entries: what you learned, what confused you, and connections to prior knowledge. Writing consolidates learning and reveals patterns over time.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:learning:skill-progression',
      content:
        'Break skills into sub-skills and practice them individually before combining. Master the fundamentals before advancing — advanced techniques built on shaky foundations crumble under pressure.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:learning:deliberate-practice',
      content:
        'Deliberate practice targets specific weaknesses with focused repetition and immediate feedback. Mindless repetition builds habit, not skill. Practice at the edge of your ability.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:learning:course-evaluation',
      content:
        "Evaluate courses before committing: check the instructor's credentials, read reviews for depth (not just rating), preview the curriculum, and verify the content is current.",
      category: 'context',
      memory_type: 'context',
      importance_score: 0.7,
    },
    {
      key: 'template:learning:note-taking-systems',
      content:
        'Take notes in your own words, not verbatim transcription. Use a system (Zettelkasten, Cornell, mind maps) that encourages linking ideas across topics. Notes you never revisit are notes wasted.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:learning:knowledge-synthesis',
      content:
        'Synthesize learning by connecting new information to existing mental models. Create concept maps showing relationships between ideas. Isolated facts are forgotten; connected knowledge persists.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:learning:teaching-to-learn',
      content:
        'Teaching is the highest form of learning. Explain concepts to others, write blog posts, or create tutorials. The act of organizing knowledge for someone else deepens your own understanding.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
  ],

  // ── Fitness Coaching ──────────────────────────────────────────────────
  'fitness-coaching': [
    {
      key: 'template:fitness-coaching:periodization',
      content:
        'Structure training in cycles: macrocycles (annual goals), mesocycles (4-6 week blocks), microcycles (weekly plans). Periodization prevents plateaus and manages fatigue accumulation.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:fitness-coaching:progressive-overload',
      content:
        'Progressive overload is the fundamental driver of adaptation. Increase volume, intensity, or complexity systematically. Track every session to ensure progression is actually happening.',
      category: 'fact',
      memory_type: 'context',
      importance_score: 0.9,
    },
    {
      key: 'template:fitness-coaching:nutrition-tracking',
      content:
        'Track nutrition for awareness, not obsession. Start with protein targets (0.7-1g per pound of bodyweight), then adjust calories to goal (surplus for muscle, deficit for fat loss). Consistency beats precision.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:fitness-coaching:recovery-protocols',
      content:
        'Recovery is where adaptation happens. Prioritize sleep (7-9 hours), manage training stress with deload weeks (every 4-6 weeks), and use active recovery between hard sessions.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:fitness-coaching:movement-assessment',
      content:
        'Assess movement quality before loading. Screen for mobility restrictions, stability deficits, and compensation patterns. Fix the movement first — loading dysfunction causes injury.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:fitness-coaching:goal-calibration',
      content:
        'Set SMART fitness goals and review monthly. Adjust based on progress rate — if a goal is too easy, it does not motivate; too hard, it discourages. The sweet spot is challenging but achievable.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:fitness-coaching:habit-formation',
      content:
        'Build fitness habits by stacking them onto existing routines and starting small. A 10-minute daily workout beats a 60-minute workout you skip. Consistency creates identity.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:fitness-coaching:injury-prevention',
      content:
        'Prevent injuries with proper warm-ups, progressive loading, balanced programming (push/pull/squat/hinge), and adequate recovery. Most injuries are overuse, not acute — listen to warning signs.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:fitness-coaching:progress-measurement',
      content:
        'Measure progress with multiple metrics: strength numbers, body measurements, photos, energy levels, and performance benchmarks. The scale alone is misleading — body composition matters more than weight.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:fitness-coaching:client-communication',
      content:
        'Communicate with clients through regular check-ins that review adherence, progress, and mindset. Celebrate small wins, adjust plans proactively, and address motivation dips before they become dropout.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
  ],

  // ── Career Development ────────────────────────────────────────────────
  'career-development': [
    {
      key: 'template:career-development:skill-gap-analysis',
      content:
        'Map your current skills against your target role requirements. Identify the 2-3 highest-leverage gaps and focus development there. Trying to improve everything improves nothing.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:career-development:personal-branding',
      content:
        'Build a personal brand around a specific expertise, not a job title. Share insights consistently on 1-2 platforms. Your brand is what people say about you when you are not in the room.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:career-development:networking-strategy',
      content:
        'Network by giving value first: share relevant articles, make introductions, offer help. Build relationships before you need them. Attend events where your target peers gather.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:career-development:interview-preparation',
      content:
        'Prepare for interviews with the STAR method (Situation, Task, Action, Result) for behavioral questions. Research the company deeply, prepare thoughtful questions, and practice out loud.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:career-development:salary-negotiation',
      content:
        'Research market rates before negotiating. Anchor high, negotiate on total compensation (not just base), and get offers in writing. The best time to negotiate is when you have leverage — multiple offers or strong performance.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
    {
      key: 'template:career-development:portfolio-building',
      content:
        'Build a portfolio that shows process, not just outcomes. Include the problem, your approach, decisions made, and results achieved. Quality over quantity — 3-5 strong case studies beat 20 screenshots.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:career-development:mentorship',
      content:
        'Seek mentors who are 2-3 steps ahead, not 20. Come to mentor meetings with specific questions and updates on previous advice. The best mentorship is reciprocal — find ways to add value back.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:career-development:public-speaking',
      content:
        'Start public speaking at small venues (meetups, internal presentations) and scale up. Structure talks with one core message, three supporting points, and a memorable close. Practice reduces anxiety.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.8,
    },
    {
      key: 'template:career-development:industry-awareness',
      content:
        'Stay industry-aware by following 5-10 thought leaders, reading one industry report monthly, and attending one conference per quarter. Awareness compounds — small consistent inputs build deep understanding.',
      category: 'context',
      memory_type: 'context',
      importance_score: 0.7,
    },
    {
      key: 'template:career-development:transition-planning',
      content:
        'Plan career transitions 6-12 months ahead: build skills, grow network in the target area, create financial runway, and line up references. Successful transitions are staged, not sudden.',
      category: 'decision',
      memory_type: 'context',
      importance_score: 0.85,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Returns the seeded memories for a given agent role ID.
 * Returns an empty array if the role is not found.
 */
export function getRoleMemories(roleId: string): StarterMemory[] {
  return ROLE_MEMORIES[roleId] ?? [];
}

/**
 * Returns the seeded memories for a given team template ID.
 * Returns an empty array if the template is not found.
 */
export function getTemplateMemories(templateId: string): StarterMemory[] {
  return TEMPLATE_MEMORIES[templateId] ?? [];
}
