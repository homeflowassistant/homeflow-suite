import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { uploadToGhlMedia } from "../ghl-service.js";

const UPLOAD_PATH = "/api/request-scheduling/upload-image";
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

function queryText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function safeFileName(value: string | undefined, contentType: string): string {
  const extension = contentType.split("/")[1]?.split(";")[0] || "bin";
  const normalized = value?.replace(/[^a-zA-Z0-9._-]/g, "_");
  return normalized || `custom_quote_image_${Date.now()}.${extension}`;
}

export function registerRequestSchedulingUploadRoutes(app: Express): void {
  app.post(
    UPLOAD_PATH,
    express.raw({
      type: ["image/*", "application/octet-stream"],
      limit: MAX_IMAGE_BYTES,
    }),
    async (req: Request, res: Response) => {
      const locationId = queryText(req.query.locationId);
      const contentType = String(req.headers["content-type"] ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();

      if (!locationId) {
        res.status(400).json({
          success: false,
          code: "LOCATION_ID_REQUIRED",
          message: "locationId is required.",
        });
        return;
      }

      if (!contentType.startsWith("image/")) {
        res.status(415).json({
          success: false,
          code: "IMAGE_CONTENT_TYPE_REQUIRED",
          message: "The upload must use an image content type.",
        });
        return;
      }

      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (body.length === 0) {
        res.status(400).json({
          success: false,
          code: "IMAGE_BODY_REQUIRED",
          message: "The image body is empty.",
        });
        return;
      }

      const fileName = safeFileName(queryText(req.query.fileName), contentType);
      const dataUri = `data:${contentType};base64,${body.toString("base64")}`;
      const url = await uploadToGhlMedia(locationId, dataUri, fileName);

      if (!url || url.startsWith("data:")) {
        res.status(502).json({
          success: false,
          code: "IMAGE_UPLOAD_FAILED",
          message: "The image could not be uploaded to the media library.",
        });
        return;
      }

      console.log("[Request Scheduling] image uploaded", {
        locationId,
        fileName,
        contentType,
        size: body.length,
      });
      res.status(200).json({ success: true, url, fileName });
    }
  );

  app.use(
    UPLOAD_PATH,
    (
      error: unknown,
      _req: Request,
      res: Response,
      next: NextFunction
    ) => {
      const parserError = error as { status?: number; type?: string };
      if (
        parserError?.status === 413 ||
        parserError?.type === "entity.too.large"
      ) {
        res.status(413).json({
          success: false,
          code: "IMAGE_TOO_LARGE",
          message: `Each image must be smaller than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
        });
        return;
      }
      next(error);
    }
  );
}
