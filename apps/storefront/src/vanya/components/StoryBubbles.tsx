'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';

/** One circular category story: CMS banner (title, image, link). */
export interface StoryBubble {
  id: string;
  title: string;
  image: string;
  href: string;
}

interface StoryBubblesProps {
  categories: StoryBubble[];
}

export function StoryBubbles({ categories }: StoryBubblesProps) {
  if (categories.length === 0) return null;

  return (
    <section className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 select-none">
      <div className="flex items-center justify-between sm:justify-center gap-4 sm:gap-6 lg:gap-8 overflow-x-auto no-scrollbar py-2">
        {categories.map((cat, idx) => (
          <motion.div
            key={cat.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04, duration: 0.4 }}
            whileHover={{ y: -4 }}
            className="shrink-0"
          >
            <Link href={cat.href} className="flex flex-col items-center gap-2.5 cursor-pointer group">
            {/* Circular Image Container with Subtle Border */}
            <div className="w-18 h-18 sm:w-22 sm:h-22 lg:w-26 lg:h-26 rounded-full overflow-hidden p-0.5 border border-[#DFD7CB] group-hover:border-[#181716] group-hover:shadow-md transition-all duration-300 bg-white">
              <div className="w-full h-full rounded-full overflow-hidden bg-[#FAF8F5]">
                <img
                  src={cat.image}
                  alt={cat.title}
                  loading="lazy"
                  className="w-full h-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-110"
                />
              </div>
            </div>

            {/* Title */}
            <span className="text-[10px] sm:text-[11px] tracking-[0.16em] uppercase font-medium text-[#29221B] group-hover:text-black transition-colors text-center max-w-[85px] sm:max-w-[95px] truncate">
              {cat.title}
            </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
