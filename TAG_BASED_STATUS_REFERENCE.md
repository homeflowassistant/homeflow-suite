# Tag-Based Status Implementation - Quick Reference

## For Developers

### Using Status Calculation in Your Code

```typescript
import {
  calculateReviewContactStatus,
  findReviewPipelineId,
  REVIEW_STATUS_TAGS,
} from "@shared/reviewStatus";

// Calculate status for a contact
const status = calculateReviewContactStatus({
  contact: contactData,
  isWonInReviewPipeline: hasWon,
});
```

### Required GHL Tags

Your GHL workflows must add/remove these tags:

**Review Reactivation Workflow:**
- Add `review_reactivation_active` at start
- Remove `review_reactivation_active` and add `review_reactivation_finished` at end/exit

**Review Request Workflow:**
- Add `review_request_active` at start
- Remove `review_request_active` and add `review_request_finished` at end/exit

### Status Priority

```
1. DND enabled → "DND"
2. Won opportunity in Review pipeline → "Clicked"
3. Has active workflow tag → "Follow up"
4. Has finished workflow tag (no active) → "Finished"
5. None of above → "" (empty)
```

### Checking Contact Status

```typescript
// Option 1: Backend-only (fast, but no opportunity data)
const status = determineContactStatus(contact);

// Option 2: With opportunity checking (recommended for UI)
const reviewStatus = calculateReviewContactStatus({
  contact,
  isWonInReviewPipeline: hasWon,
});
```

### Finding Review Pipeline

```typescript
// Fetch pipelines from GHL
const pipelines = await trpc.ghl.getPipelines.query({ locationId });

// Find Review pipeline ID
const reviewPipelineId = findReviewPipelineId(pipelines);

// Check for won opportunities
if (reviewPipelineId) {
  const { hasWon } = await trpc.ghl.hasWonOpportunity.query({
    locationId,
    contactId,
    pipelineId: reviewPipelineId,
  });
}
```

## For GHL Setup

### Workflow Configuration

1. **Create "01. Review Reactivation" workflow** (if not exists)
   - Trigger: First-time contacts from CSV
   - Start action: Add tag `review_reactivation_active`
   - Exit/End action: Remove `review_reactivation_active`, add `review_reactivation_finished`

2. **Create "02. Review Request" workflow** (if not exists)
   - Trigger: After successful review reactivation
   - Start action: Add tag `review_request_active`
   - Exit/End action: Remove `review_request_active`, add `review_request_finished`

3. **Ensure "Review" Pipeline exists**
   - Used for opportunity status checking
   - Name must contain "review" (case-insensitive)
   - Automatically discovered by app

### Testing Workflows

1. Create test contact with manual tag assignment
2. Assign tag: `review_reactivation_active`
3. Go to Contacts page in app
4. Verify status shows "Follow up"
5. Remove tag, assign: `review_reactivation_finished`
6. Refresh page
7. Verify status shows "Finished"

## API Changes

### New tRPC Procedures

**Get Pipelines:**
```
POST /trpc/ghl.getPipelines
Input: { locationId: string }
Output: Array<{ id: string; name: string }>
```

**Check Won Opportunity:**
```
POST /trpc/ghl.hasWonOpportunity
Input: {
  locationId: string,
  contactId: string,
  pipelineId: string
}
Output: { hasWon: boolean }
```

### Backend Changes

**New Functions in ghl-service.ts:**
- `getPipelines(locationId)` - Fetch pipelines
- `hasOpportunityInStatus(locationId, contactId, pipelineId, status)` - Check opportunities

**Updated Functions:**
- `determineContactStatus(contact)` - Now uses tag-based logic

## Troubleshooting

### Status Shows Wrong Value

**Check:**
1. Are tags being added to contact? (View contact in GHL)
2. Are tag names exact? (Case-insensitive, but no typos)
3. Are workflow tags being removed properly on exit? (Check workflow exit actions)

### Status Not Updating

**Check:**
1. Is pagination cache cleared? (Try "Clear All" button)
2. Did workflow tag recently change? (May take few seconds to sync)
3. Is location connected? (Check connection status on page)

### "Clicked" Status Not Appearing

**Check:**
1. Does "Review" pipeline exist? (Search pipelines for "review")
2. Is contact's opportunity in "won" status? (Check in GHL)
3. Can app access opportunities? (Check API logs)

## Performance Notes

- Pipeline lookup is cached per page load
- Opportunity checks run in parallel for all visible contacts
- Non-blocking: failures don't prevent page render
- Fallback to backend status if check fails

## Future Integration Points

If you add status sync to GHL custom field:

```typescript
// Hook into status calculation result
if (statusChanged) {
  await updateContactReviewStatus(contactId, newStatus);
}
```

For batch operations, use existing `processBatch` pattern.
