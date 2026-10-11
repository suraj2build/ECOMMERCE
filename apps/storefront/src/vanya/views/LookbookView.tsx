'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { storiesFor, storyHref, type LookbookDepartment, type Story } from '@/lib/lookbook';
import { cityIssue, issueHref } from '@/lib/lookbook-issue';

function CompleteEdition() {
  return (
    <Link
      href={issueHref(cityIssue)}
      className="block bg-[#292820] text-[#faf7f2] rounded-2xl overflow-hidden my-10"
    >
      <div className="grid md:grid-cols-2">
        <img
          src={cityIssue.cover}
          alt="A City, Three Moods complete book cover"
          className="w-full h-[420px] object-cover object-top"
          loading="lazy"
        />
        <div className="p-8 sm:p-12 flex flex-col justify-center">
          <p className="text-xs uppercase tracking-[.22em]">Complete edition 01 / 32 pages</p>
          <h2 className="font-editorial text-4xl sm:text-5xl my-5">
            A city.
            <br />
            Three moods.
          </h2>
          <p className="text-sm leading-7">
            Riya in the morning. Deeksha through the afternoon. Heena after the light. Twelve
            complete looks, one story-led book.
          </p>
          <span className="underline mt-7 text-sm">Open the complete lookbook →</span>
        </div>
      </div>
    </Link>
  );
}

export function LookbookTeaser({ department }: { department: LookbookDepartment }) {
  const [showComplete, setShowComplete] = useState(true);
  const [stories, setStories] = useState<
    (Story & { presentation?: string; showOnHome?: boolean })[]
  >(storiesFor(department));
  useEffect(() => {
    let active = true;
    setStories(storiesFor(department));
    void fetch(
      (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') +
        '/api/v1/storefront/lookbooks?department=' +
        department,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((index) => {
        if (!active || !index) return;
        const published = Array.isArray(index.stories)
          ? index.stories.filter(
              (s: Story & { showOnHome?: boolean }) => s.department === department && s.showOnHome,
            )
          : [];
        setShowComplete(
          !(index.hiddenBuiltins ?? []).includes(cityIssue.slug) &&
            !(index.stories ?? []).some((s: Story) => s.slug === cityIssue.slug),
        );
        const hidden = new Set([
          ...(index.hiddenBuiltins ?? []),
          ...(index.stories ?? []).map((s: Story) => s.slug),
        ]);
        setStories([...published, ...storiesFor(department).filter((s) => !hidden.has(s.slug))]);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [department]);
  return (
    <section className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-16 w-full">
      <div className="flex justify-between items-end gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-[.22em]">The editorial</p>
          <h2 className="font-editorial text-4xl mt-3">Wear the story.</h2>
        </div>
        <Link href={'/' + department + '/lookbook'} className="underline text-sm">
          Explore the lookbook →
        </Link>
      </div>
      {department === 'women' && showComplete && <CompleteEdition />}
      <div className="grid md:grid-cols-2 gap-6">
        {stories.map((story) => (
          <Link
            key={story.slug}
            href={
              story.presentation === 'book'
                ? '/' + department + '/lookbook/issues/' + story.slug
                : storyHref(story)
            }
            className="group"
          >
            <div className="aspect-[4/3] overflow-hidden rounded-2xl">
              <img
                src={story.cover}
                alt={story.title + ' outfit editorial'}
                loading="lazy"
                className="w-full h-full object-cover object-top group-hover:scale-[1.02] transition-transform"
              />
            </div>
            <p className="text-xs uppercase tracking-widest mt-5">
              {story.occasion} · {story.looks.length} looks
            </p>
            <h3 className="font-editorial text-3xl mt-2">{story.title}</h3>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function LookbookView({
  department,
  stories: supplied,
  showComplete = true,
}: {
  department: LookbookDepartment;
  stories?: (Story & { presentation?: string })[];
  showComplete?: boolean;
}) {
  const [occasion, setOccasion] = useState('All');
  const stories = supplied ?? storiesFor(department);
  const featured =
    department === 'women' && showComplete
      ? {
          ...cityIssue,
          occasion: 'Complete edition',
          model: 'Riya, Deeksha & Heena',
          presentation: 'book' as const,
        }
      : stories[0];

  const filtered = stories.filter((story) => occasion === 'All' || story.occasion === occasion);
  if (!featured) {
    return (
      <div className="w-full max-w-[1440px] mx-auto px-6 sm:px-12 py-24 text-center">
        <p className="text-sm leading-6">New stories for this department are coming soon.</p>
      </div>
    );
  }
  return (
    <div className="w-full">
      <section className="grid lg:grid-cols-2 max-w-[1440px] mx-auto">
        <div className="px-6 py-14 sm:px-12 lg:py-24 flex flex-col justify-center">
          <p className="text-xs uppercase tracking-[.25em]">
            {department === 'men' ? "Men's" : "Women's"} lookbook
          </p>
          <h1 className="font-editorial text-5xl sm:text-7xl my-6">Style, in stories.</h1>
          <p className="text-base leading-7 max-w-md">
            Photoshoot edits to explore, outfits to make your own. Discover the pieces behind each
            moment.
          </p>
          <Link
            className="mt-8 underline"
            href={
              featured?.presentation === 'book'
                ? '/' + department + '/lookbook/issues/' + featured.slug
                : featured
                  ? storyHref(featured)
                  : '/' + department
            }
          >
            {featured?.presentation === 'book'
              ? 'Open the complete lookbook'
              : 'Explore ' + (featured?.title ?? 'the collection')}{' '}
            →
          </Link>
        </div>
        <img
          src={featured?.cover ?? cityIssue.cover}
          alt={(featured?.title ?? 'Lookbook') + ' campaign cover'}
          className="w-full h-[520px] sm:h-[650px] object-contain bg-[#e9e4dc]"
          fetchPriority="high"
        />
      </section>
      <section className="max-w-[1440px] mx-auto px-6 sm:px-12 py-14">
        <nav aria-label="Lookbook departments" className="flex gap-6 text-sm mb-8">
          <Link
            href="/women/lookbook"
            aria-current={department === 'women' ? 'page' : undefined}
            className={department === 'women' ? 'underline' : ''}
          >
            Women
          </Link>
          <Link
            href="/men/lookbook"
            aria-current={department === 'men' ? 'page' : undefined}
            className={department === 'men' ? 'underline' : ''}
          >
            Men
          </Link>
        </nav>
        <div
          role="group"
          aria-label="Filter stories by occasion"
          className="flex flex-wrap gap-3 mb-10"
        >
          {['All', ...new Set(stories.map((story) => story.occasion))].map((tag) => (
            <button
              key={tag}
              aria-pressed={occasion === tag}
              onClick={() => setOccasion(tag)}
              className={
                'rounded-full border px-5 py-2 text-sm ' +
                (occasion === tag ? 'bg-[#241F1A] text-white border-[#241F1A]' : 'border-[#b9ada1]')
              }
            >
              {tag}
            </button>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-10">
          {filtered.map((story) => (
            <article key={story.slug}>
              <Link
                href={
                  story.presentation === 'book'
                    ? '/' + department + '/lookbook/issues/' + story.slug
                    : storyHref(story)
                }
              >
                <img
                  src={story.cover}
                  alt={story.title + ' campaign'}
                  loading="lazy"
                  className="w-full aspect-[4/5] object-cover object-top rounded-2xl"
                />
                <p className="text-xs uppercase tracking-widest mt-6">
                  {story.occasion} · {story.looks.length} looks
                </p>
                <h2 className="font-editorial text-4xl mt-3">{story.title}</h2>
                <p className="text-sm leading-6 mt-3">{story.intro}</p>
                <span className="inline-block underline mt-5">
                  {story.looks.every((l) => l.items.length)
                    ? 'Shop the story →'
                    : 'Explore the story →'}
                </span>
              </Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
