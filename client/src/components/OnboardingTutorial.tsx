import { Video } from "lucide-react";

type OnboardingTutorialProps = {
  title: string;
  youtubeId: string;
  description?: string;
};

export default function OnboardingTutorial({ title, youtubeId, description }: OnboardingTutorialProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby={`tutorial-${youtubeId}`}>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
          <Video className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h3 id={`tutorial-${youtubeId}`} className="text-base font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {description || "Watch this walkthrough before completing the setup form below."}
          </p>
        </div>
      </div>
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-950">
        <iframe
          src={`https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}`}
          title={title}
          className="h-full w-full border-0"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    </section>
  );
}
