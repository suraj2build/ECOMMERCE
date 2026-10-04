import { isPreviewDeployment } from '@/lib/seo';

/** LR-010: a hosted preview says so on every page, so nobody mistakes it for
 * the live shop. Rendered on the server from DEPLOYMENT_STAGE. */
export function PreviewBanner() {
  if (!isPreviewDeployment()) return null;
  return (
    // Above the full-screen department gateway (z-[100]) so the home page shows it too.
    <>
      {/* Full-height views (the department gateway) subtract this strip. */}
      <style>{':root{--preview-banner-h:28px}'}</style>
      <div role="note" className="relative z-[110] flex h-7 items-center justify-center overflow-hidden bg-[#181716] px-4 text-center text-[11px] font-medium tracking-wide text-[#faf8f5]">
        Preview for review only · No real orders or payments
      </div>
    </>
  );
}
