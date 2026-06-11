'use client';

import { useState, useEffect } from 'react';

interface Article {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const SENTIMENT: Record<Article['sentiment'], { label: string; cls: string }> = {
  positive: { label: 'bullish', cls: 'text-profit border-profit/25' },
  negative: { label: 'bearish', cls: 'text-loss border-loss/25' },
  neutral: { label: 'neutral', cls: 'text-gray-500 border-white/10' },
};

const tag = (s: Article['sentiment']) => {
  const t = SENTIMENT[s] ?? SENTIMENT.neutral;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full border font-mono text-[9px] uppercase tracking-[0.14em] ${t.cls}`}>
      {t.label}
    </span>
  );
};

interface NewsFeedProps {
  className?: string;
}

/**
 * Editorial front page, not a widget: one lead story at display size, then
 * numbered ruled rows. Sentiment is a labeled tag; metadata is mono;
 * whitespace and hairlines do the layout.
 */
export default function NewsFeed({ className = '' }: NewsFeedProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNews = async () => {
    try {
      const res = await fetch('/api/crypto-news');
      const data = await res.json();
      if (data.articles?.length) setArticles(data.articles);
    } catch {
      // silent — keep stale data
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    const id = setInterval(fetchNews, 60_000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className={`mt-12 space-y-12 ${className}`}>
        <div className="space-y-4">
          <div className="h-3 w-28 bg-white/[0.05] rounded animate-pulse" />
          <div className="h-12 w-4/5 bg-white/[0.06] rounded animate-pulse" />
          <div className="h-12 w-3/5 bg-white/[0.06] rounded animate-pulse" />
        </div>
        <div className="space-y-7">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-5 bg-white/[0.04] rounded animate-pulse" style={{ width: `${85 - i * 9}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <p className={`mt-16 font-mono text-xs text-gray-600 ${className}`}>
        The wire is quiet. Headlines return shortly.
      </p>
    );
  }

  const [lead, ...rest] = articles;

  return (
    <div className={`mt-12 ${className}`}>
      {/* Lead story */}
      <a
        href={lead.url}
        target="_blank"
        rel="noopener noreferrer"
        data-cursor="hover"
        className="group block"
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="font-mono text-[10px] text-vermilion">01</span>
          {tag(lead.sentiment)}
          <span className="font-mono text-[10px] text-gray-600">
            {timeAgo(lead.publishedAt)} · {lead.source}
          </span>
        </div>
        <h2 className="font-display font-[800] text-3xl sm:text-5xl leading-[1.08] tracking-[-0.02em] text-white max-w-4xl group-hover:text-gray-200 transition-colors">
          {lead.title}
          <span className="inline-block ml-3 text-gray-600 text-2xl sm:text-3xl align-middle group-hover:text-vermilion group-hover:translate-x-1 transition-all">↗</span>
        </h2>
      </a>

      {/* Rule — square endpoint, hairline */}
      <div className="flex items-center mt-14 mb-2">
        <div className="w-2.5 h-2.5 bg-vermilion" />
        <div className="flex-1 h-px bg-white/[0.12]" />
      </div>

      {/* The wire */}
      {rest.map((a, i) => (
        <a
          key={a.url}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          data-cursor="hover"
          className="group flex items-baseline gap-5 py-5 border-b border-white/[0.06] hover:bg-white/[0.02] hover:translate-x-0.5 transition-all"
        >
          <span className="font-mono text-[10px] text-gray-600 w-6 flex-shrink-0">
            {String(i + 2).padStart(2, '0')}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-base sm:text-lg font-semibold text-gray-200 leading-snug group-hover:text-white transition-colors">
              {a.title}
            </span>
            <span className="flex items-center gap-3 mt-1.5">
              {tag(a.sentiment)}
              <span className="font-mono text-[10px] text-gray-600">
                {timeAgo(a.publishedAt)} · {a.source}
              </span>
            </span>
          </span>
          <span className="font-mono text-xs text-gray-700 group-hover:text-vermilion transition-colors flex-shrink-0">↗</span>
        </a>
      ))}
    </div>
  );
}
