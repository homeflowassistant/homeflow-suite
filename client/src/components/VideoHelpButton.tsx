import { PlayCircle, Video } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type VideoHelpItem = {
  title: string;
  youtubeId: string;
  description?: string;
};

type VideoHelpButtonProps = {
  pageTitle: string;
  videos: VideoHelpItem[];
};

export default function VideoHelpButton({ pageTitle, videos }: VideoHelpButtonProps) {
  if (videos.length === 0) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700 shadow-sm transition hover:border-cyan-300 hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2"
          aria-label={`Watch ${pageTitle} setup video${videos.length > 1 ? "s" : ""}`}
          title={`Watch ${pageTitle} setup video${videos.length > 1 ? "s" : ""}`}
        >
          <Video className="h-4 w-4" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-200 bg-slate-50 px-5 py-4 pr-12 text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <PlayCircle className="h-5 w-5 text-cyan-600" aria-hidden="true" />
            {pageTitle} setup videos
          </DialogTitle>
          <DialogDescription>
            Watch the walkthrough, then close this window to continue completing the setup page.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(90vh-105px)] space-y-6 overflow-y-auto p-5 sm:p-6">
          {videos.map((video) => (
            <section key={video.youtubeId} className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">{video.title}</h3>
              {video.description && <p className="text-xs leading-relaxed text-slate-500">{video.description}</p>}
              <div className="aspect-video overflow-hidden rounded-xl bg-slate-950">
                <iframe
                  src={`https://www.youtube.com/embed/${encodeURIComponent(video.youtubeId)}`}
                  title={video.title}
                  className="h-full w-full border-0"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
