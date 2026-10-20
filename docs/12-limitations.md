# Limitations

This list exists so nobody has to discover these by surprise. Each item states
the limitation, its consequence, and what a correct fix would require. Nothing
here is described as "coming soon".

---

## 1. Product scope

| Limitation | Consequence | A real fix |
|---|---|---|
| No email delivery | No verification, password reset, or reminders | An email provider plus token flows |
| No OAuth / SSO | Users create a local password | OIDC integration |
| No MFA | Password compromise = account compromise | TOTP or WebAuthn |
| No file attachments | Résumés and cover letters live outside the app | Object storage plus signed URLs |
| No sharing or teams | One owner per record | Workspace model, roles, invite flow |
| No native apps | Browser only | A separate client using the same API |

## 2. Security

| Limitation | Consequence | A real fix |
|---|---|---|
| No Content-Security-Policy | Weaker defence-in-depth against injected script | Nonces/hashes for the inline module scripts, then a strict policy |
| No CSRF token | Relies on `SameSite=Lax` + JSON + CORS | Double-submit token if the app is ever embedded cross-origin |
| Rate limits are in-memory | Per process, cleared on restart, not shared across instances | Redis or a Mongo-backed counter |
| No account lockout notification | A targeted attack produces no alert | Email or an audit feed |
| Duplicate registration reveals an email is registered (`409`) | Account enumeration | Verification-based flow with an identical response |
| No security audit trail | Cannot reconstruct who read what | Structured event logging |
| `ALLOW_LEGACY_ADOPTION` exists | If enabled on a shared database, the first registration could adopt ownerless rows | Run once, then delete the flag and the code |
| No dependency scanning in CI | A vulnerable transitive package is not flagged automatically | `npm audit` in a pipeline |

## 3. Data and scale

| Limitation | Consequence | A real fix |
|---|---|---|
| No soft delete | A deleted record is gone | `deletedAt` plus filtered queries and a retention job |
| Status history keeps the last 100 transitions | Very old changes are dropped | Archive into a separate collection |
| Analytics load the user's documents | Memory grows with record count | Aggregation pipeline (`$group`) or a summary collection |
| Search without a text index | Collection scan scoped by `userId` | Compound text index or Atlas Search |
| Client pagination for aggregates | `ceil(n/100)` requests for large accounts | Server-side summaries and exports |
| One database, no read replicas | Reads and writes share a primary | Replica set and read preference |
| No migration framework | Schema changes are applied in place | Versioned migrations |

These are not problems at 10–1 000 applications. The honest threshold is roughly
"when a page needs more than a few hundred rows", at which point the aggregate
views should move to server-side queries.

## 4. Frontend

| Limitation | Consequence | A real fix |
|---|---|---|
| No framework, no build step | Large pages keep their logic in one inline script | Extract page controllers into modules as they grow |
| No client-side router | Every navigation is a full page load | Add a router only if the app becomes more interactive |
| No offline support | Requires a connection | Service worker plus a local cache |
| No virtualised lists | Very long tables render every row on the page | Virtual scrolling |
| No i18n | English only | Message catalogue and locale-aware date/number formatting |
| No theme switch | One design | CSS variables already support a second theme, but no UI exists |
| Reduced-motion handled by CSS only | Custom JS animation would need its own guard | Check `matchMedia` where JS animates |

## 5. Testing

| Limitation | Consequence | A real fix |
|---|---|---|
| No browser automation | UI regressions are caught manually | Playwright or Cypress |
| No visual regression | Layout changes are reviewed by eye | Screenshot diffing |
| No coverage metric | "Not covered" is a judgement, not a number | Coverage tooling |
| Static checks parse structure, not behaviour | A logically wrong but syntactically valid module passes | Runtime tests |
| No load tests | Throughput and latency are unmeasured | k6 or autocannon |
| Rate limits reset between test runs | The suite cannot test long-window behaviour | A shared store with injectable time |

## 6. Operations

| Limitation | Consequence | A real fix |
|---|---|---|
| Not deployed | No public URL exists | Follow [11-deployment.md](11-deployment.md) |
| No CI configuration | Tests are runnable, not enforced | A pipeline running `npm test` on every push |
| No metrics or alerts | Only `/api/health` is a probe | Metrics, dashboards, alerting |
| No structured logs | Debugging relies on text logs | JSON logs with request ids |
| No log rotation | Files grow if redirected | Platform log handling or `logrotate` |
| No multi-region | One process, one database | Replicas and a global deployment |

## 7. Deliberate omissions (not bugs)

Some missing features are choices, and should be defended rather than apologised
for:

1. **No "average time to offer".** There is no offer timestamp in the data
   model, so the number would be fabricated. The card was removed instead of
   computing something misleading.
2. **No drag-and-drop.** Status changes go through an accessible dropdown. Drag
   and drop needs a keyboard equivalent anyway, and the dropdown is that
   equivalent — one implementation, not two.
3. **No fake social proof.** The landing page has no invented testimonials,
   customer counts or logos.
4. **No hidden truncation.** Lists show every record in their window. The
   server's 100-row page cap is a transport limit, and aggregate views page
   through it.
5. **Legacy records show an empty history.** "No status changes recorded yet."
   is true; inventing a first entry would not be.

## 8. Browser support

Modern evergreen browsers only:

| Feature | Needed by |
|---|---|
| ES modules | Every page |
| `fetch` | `js/api.js` |
| `<dialog>` with `showModal` | `js/dialog.js` |
| `Element.closest` | Delegated events |
| `Intl` (via `toLocaleDateString`) | Date formatting |

No polyfills are shipped. An unsupported browser shows a static page without the
interactive workspace; it does not silently corrupt data.

## 9. What is genuinely production-ready

To be fair to the project, these are solid:

- Password hashing and session handling
- Server-side ownership checks on every private record
- Input validation and a consistent error envelope
- Date handling across timezones
- Cascade deletes and bounded history
- Accessible dialogs, dropdowns and keyboard navigation
- A test suite that starts its own server and covers isolation

The limitations above are scope and infrastructure, not a thin demo pretending
to be finished.
