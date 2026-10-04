import { isPreviewDeployment } from '@/lib/seo';

/** LR-010: a hosted preview says so on every page, so nobody mistakes it for
 * the live shop. Rendered on the server from DEPLOYMENT_STAGE. */
export function PreviewBanner() {
  if (!isPreviewDeployment()) return null;
  return (
    // Above the full-screen department gateway (z-[100]) so the home page shows it too.
    <div role="note" className="relative z-[110] bg-[#181716] px-4 py-1.5 text-center text-[11px] font-medium tracking-wide text-[#faf8f5]">
      Preview for review only · No real orders or payments
    </div>
  );
}
