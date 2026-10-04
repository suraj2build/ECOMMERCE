import { isPreviewDeployment } from '@/lib/seo';

/** LR-010: a hosted preview says so on every page, so nobody mistakes it for
 * the live shop. Rendered on the server from DEPLOYMENT_STAGE. */
export function PreviewBanner() {
  if (!isPreviewDeployment()) return null;
  return (
    <div role="note" className="bg-[#181716] px-4 py-2 text-center text-xs font-medium tracking-wide text-[#faf8f5]">
      Preview site for review only. Payments are in test mode and no order is fulfilled.
    </div>
  );
}
