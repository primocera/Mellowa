# XAPP-V12-01 · Final cross-app isolation and launch-consistency review (BOTH apps)

- **Run after:** SC-V12-08 (LaunchBloom repo) and MW-V12-09
- **Primary risk removed:** Scalvya and Mellowa share operational providers; a fix in one app can still leak events, email or release assumptions into the other.
- **Note:** Requires the Scalvya/LaunchBloom candidate to be frozen too. Only the Mellowa side can be done in this repo.

## Prompt

Perform a read-only-first cross-app review of primocera/LaunchBloom and primocera/Mellowa at their newly frozen candidate SHAs. Make only focused regression-test or documentation fixes; any product-code change invalidates the affected candidate and requires re-freezing.

Cross-app checks:
1. Stripe:
   - each app allowlists only its own product and price IDs;
   - foreign events are ignored safely;
   - no foreign event creates entitlement, subscription rows, failure alerts or email;
   - webhook idempotency keys cannot collide across products.
2. Email:
   - sender identities and unsubscribe domains are correct per app;
   - optional suppression never crosses brands;
   - transactional messages cannot be triggered by foreign events.
3. Auth/Supabase:
   - callback URLs, site URLs and redirect allowlists are app-specific;
   - E2E projects and marker guards cannot target production or the other app.
4. Analytics:
   - event namespaces do not collide;
   - no sensitive campaign or wellbeing content is captured;
   - build/app identifiers allow accurate separation.
5. Production configuration:
   - readiness checks validate the correct brand, domains, prices and provider configuration;
   - no secret values are printed.
6. Commercial content:
   - both apps state the same trial mechanics accurately where their offers are equivalent;
   - each app's price, currency, renewal and cancellation wording matches its own Stripe catalog;
   - neither app inherits the other app's claims or audience.
7. Release truth:
   - evidence is pinned to the correct repository and candidate;
   - accepted risks produce CONDITIONAL GO rather than full GO;
   - no historical or superseded document is presented as current.

Add symmetric regression fixtures: a Mellowa event sent to Scalvya and a Scalvya event sent to Mellowa. Both must be acknowledged without side effects.

If any code changes, invalidate and re-cut only the affected candidate. End with a two-column final report: Scalvya status, Mellowa status, shared risks, owner-only actions and whether paid acquisition may safely expand.
