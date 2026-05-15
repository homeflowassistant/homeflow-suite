/**
 * Test suite for tag-based review contact status calculation
 * Verifies all acceptance criteria from the implementation prompt
 */

import { describe, it, expect } from "vitest";
import {
  calculateReviewContactStatus,
  findReviewPipelineId,
  getNormalizedTags,
  isContactDnd,
  type ReviewContactStatus,
} from "@shared/reviewStatus";

describe("Tag-based Review Contact Status Calculation", () => {
  describe("Acceptance Criteria", () => {
    it("DND contact should return 'DND' regardless of other factors", () => {
      const contact = {
        dnd: true,
        tags: ["review_reactivation_active", "clicked"],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: true,
      });

      expect(status).toBe("DND");
    });

    it("Won review opportunity should return 'Clicked' for non-DND contact", () => {
      const contact = {
        dnd: false,
        tags: [],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: true,
      });

      expect(status).toBe("Clicked");
    });

    it("Active Review Reactivation tag should return 'Follow up'", () => {
      const contact = {
        dnd: false,
        tags: ["review_reactivation_active"],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: false,
      });

      expect(status).toBe("Follow up");
    });

    it("Active Review Request tag should return 'Follow up'", () => {
      const contact = {
        dnd: false,
        tags: ["review_request_active"],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: false,
      });

      expect(status).toBe("Follow up");
    });

    it("Finished Review Reactivation tag (no active) should return 'Finished'", () => {
      const contact = {
        dnd: false,
        tags: ["review_reactivation_finished"],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: false,
      });

      expect(status).toBe("Finished");
    });

    it("Finished Review Request tag (no active) should return 'Finished'", () => {
      const contact = {
        dnd: false,
        tags: ["review_request_finished"],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: false,
      });

      expect(status).toBe("Finished");
    });

    it("Both active and finished tags should return 'Follow up' (active takes priority)", () => {
      const contact = {
        dnd: false,
        tags: [
          "review_reactivation_active",
          "review_reactivation_finished",
        ],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: false,
      });

      expect(status).toBe("Follow up");
    });

    it("No matching data should return empty string", () => {
      const contact = {
        dnd: false,
        tags: [],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: false,
      });

      expect(status).toBe("");
    });

    it("Priority: DND overrides everything", () => {
      const contact = {
        dnd: true,
        tags: ["clicked"],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: true,
      });

      expect(status).toBe("DND");
    });

    it("Priority: Won opportunity overrides workflow tags", () => {
      const contact = {
        dnd: false,
        tags: ["review_reactivation_finished"],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: true,
      });

      expect(status).toBe("Clicked");
    });

    it("Priority: Active workflow tag overrides finished workflow tag", () => {
      const contact = {
        dnd: false,
        tags: [
          "review_request_active",
          "review_reactivation_finished",
        ],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: false,
      });

      expect(status).toBe("Follow up");
    });
  });

  describe("Tag Normalization", () => {
    it("Should handle case-insensitive tags", () => {
      const contact = {
        dnd: false,
        tags: ["REVIEW_REACTIVATION_ACTIVE"],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: false,
      });

      expect(status).toBe("Follow up");
    });

    it("Should handle tags with extra whitespace", () => {
      const contact = {
        dnd: false,
        tags: ["  review_reactivation_active  "],
      };

      const status = calculateReviewContactStatus({
        contact,
        isWonInReviewPipeline: false,
      });

      expect(status).toBe("Follow up");
    });

    it("Should extract tags from mixed formats", () => {
      const contact = {
        dnd: false,
        tags: [
          "review_reactivation_active",
          { name: "other_tag" },
          "review_request_finished",
        ],
      };

      const tags = getNormalizedTags(contact);
      expect(tags).toContain("review_reactivation_active");
      expect(tags).toContain("other_tag");
      expect(tags).toContain("review_request_finished");
    });
  });

  describe("DND Detection", () => {
    it("Should detect dnd boolean field", () => {
      const contact = { dnd: true };
      expect(isContactDnd(contact)).toBe(true);
    });

    it("Should detect doNotDisturb field", () => {
      const contact = { doNotDisturb: true };
      expect(isContactDnd(contact)).toBe(true);
    });

    it("Should detect dndSettings object", () => {
      const contact = {
        dndSettings: {
          sms: false,
          email: true,
        },
      };
      expect(isContactDnd(contact)).toBe(true);
    });

    it("Should return false for non-DND contact", () => {
      const contact = {
        dnd: false,
        doNotDisturb: false,
      };
      expect(isContactDnd(contact)).toBe(false);
    });
  });

  describe("Pipeline Resolution", () => {
    it("Should find review pipeline by name containing 'review'", () => {
      const pipelines = [
        { id: "pip_1", name: "Sales Pipeline" },
        { id: "pip_2", name: "Review Pipeline" },
        { id: "pip_3", name: "Follow Up" },
      ];

      const reviewId = findReviewPipelineId(pipelines);
      expect(reviewId).toBe("pip_2");
    });

    it("Should handle case-insensitive review pipeline name", () => {
      const pipelines = [
        { id: "pip_1", name: "REVIEW PIPELINE" },
      ];

      const reviewId = findReviewPipelineId(pipelines);
      expect(reviewId).toBe("pip_1");
    });

    it("Should return null if no review pipeline exists", () => {
      const pipelines = [
        { id: "pip_1", name: "Sales Pipeline" },
        { id: "pip_2", name: "Follow Up" },
      ];

      const reviewId = findReviewPipelineId(pipelines);
      expect(reviewId).toBeNull();
    });

    it("Should handle _id fallback for pipeline ID", () => {
      const pipelines = [
        { _id: "pip_review", name: "Review Pipeline" },
      ];

      const reviewId = findReviewPipelineId(pipelines);
      expect(reviewId).toBe("pip_review");
    });
  });
});
