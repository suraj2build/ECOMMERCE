import { Container } from '../ui/Container';

const PROMISES = [
  { title: 'Easy Returns', body: '15-day return window on every order.' },
  { title: 'Secure Payments', body: 'UPI, cards, net banking, and Cash on Delivery.' },
  { title: 'Quality Checked', body: 'Every piece passes a QC check before it ships.' },
  { title: 'Customer Care', body: 'Real support, 7 days a week.' },
];

export function TrustPromises() {
  return (
    <section aria-label="Service promises" className="border-y border-border bg-surface py-10">
      <Container>
        <ul className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {PROMISES.map((promise) => (
            <li key={promise.title}>
              <p className="text-sm font-medium text-ink">{promise.title}</p>
              <p className="mt-1 text-xs text-ink-muted">{promise.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
