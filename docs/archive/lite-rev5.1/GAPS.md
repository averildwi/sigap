# GAPS (Lite)

Gaps and small contradictions found while cutting to Lite (PRD rev 5, updated for rev 5.1). Each line: gap -> simplest option chosen.

| # | Gap | Chosen option |
|---|---|---|
| G-L1 | A handler who is demoted or removed while handling an SOS can no longer move it (BR-58), and other admins can only act on SENT alerts, so the SOS can get stuck in ACCEPTED/HANDLING | Accept for Lite: the sender can cancel and resend; documented as E-21. Real fix (take-over / release) is Phase 2. |
| G-L2 | Two admins demoting each other (or removing each other) at the same moment can both pass the "at least one ADMIN" count and leave the community without an admin (BR-27) | Accept for Lite (very unlikely in a demo). Phase 2 can lock with a conditional update on the community. |
| G-L3 | "One open SOS per sender" (BR-55) uses `findFirst` before `create`; two requests in the same instant can both create | Accept for Lite; throttle 5/min and the UI hold-to-send make it rare. |
| G-L4 | Highlight clear-then-set (BR-36) without a unique column: two parallel highlights can leave two announcements highlighted | Accept; the list still sorts both first, and the next highlight fixes it. |
| G-L5 | Without `tokenVersion` (L-1) a password reset does not end stolen sessions | Accept for Lite; set `JWT_EXPIRES_IN=1d`. |
| G-L6 | `POST /memberships` and `POST /memberships/preview` take `communityId` in the body, which the original constraint "no `communityId` outside the path" forbids | Allowed exception: it is the target named by the scanned QR and is validated against the token (BR-20). |
| G-L7 | `PATCH .../role` takes `role` in the body | Allowed exception: it is the action itself, admin-only (BR-29), and limited to `ADMIN` / `WARGA`. |
| G-L8 | `[ADMIN]` prefix without `@Roles` departs from the skill's prefix rule; the route-guard meta-test would flag it | Deviation L-4: adapt the meta-test to accept `[ADMIN]` with `JwtAuthGuard` and no `@Roles`. |
| G-L9 | The free Resend plan has a limited daily quota; a busy demo could use it up | Accept; a failed send is only logged (BR-68), in-app + realtime still work. |
| G-L10 | Any user can create a community for any RT/RW and become its admin (no review) | Accept for the competition (A-34). The first creator "claims" the RT/RW; Phase 2 brings back review. |
| G-L11 | e2e needs the OTP code but the console adapter must never print codes | The e2e test overrides the `OtpSender` provider with a capturing fake and reads the code from it, never from logs. |
| G-L12 | After REJECTED / LEFT / REMOVED a user can request to join again without limit, so admins may get many `JOIN_REQUEST` notifications | Accept; the only protection is the 10/min throttle on `POST /memberships` (BR-80). |
| G-L13 | `POST /memberships/preview` reveals the community label and region to anyone holding a valid token | Accept; whoever holds the QR was given access by an admin, and the token expires within 2 minutes (BR-20). |
