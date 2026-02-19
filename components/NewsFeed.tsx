'use client';

import { useState, useEffect } from 'react';
import { Newspaper, ExternalLink } from 'lucide-react';

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

const SENTIMENT: Record<string, { dot: string; bg: string }> = {
  positive: { dot: 'bg-new-mint shadow-new-mint/40', bg: 'hover:bg-new-mint/[0.03]' },
  negative: { dot: 'bg-off-red shadow-off-red/40', bg: 'hover:bg-off-red/[0.03]' },
  neutral:  { dot: 'bg-gray-500', bg: 'hover:bg-white/[0.02]' },
};

export default function NewsFeed() {
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

  return (
    <div className="mt-5 sm:mt-8 bg-neutral-900/50 border border-white/[0.06] rounded-2xl overflow-hidden backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-white/[0.06]">
        <Newspaper className="w-4 h-4 text-gray-400" />
        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
          BTC News
        </span>
        {!loading && (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-new-mint animate-pulse shadow-sm shadow-new-mint/50" />
            <span className="text-[10px] text-gray-500 font-medium">Live</span>
          </span>
        )}
      </div>

      {/* Articles */}
      <div>
        {loading ? (
          <div className="p-5 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-white/[0.06] animate-pulse mt-1.5" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-white/[0.06] rounded-md animate-pulse" style={{ width: `${75 - i * 12}%` }} />
                  <div className="h-2.5 bg-white/[0.04] rounded-md animate-pulse w-2/5" />
                </div>
              </div>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-gray-600">
            No news available
          </div>
        ) : (
          articles.map((article, i) => {
            const s = SENTIMENT[article.sentiment] || SENTIMENT.neutral;
            return (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-start gap-3 px-5 py-3.5 transition-colors group border-b border-white/[0.03] last:border-b-0 ${s.bg}`}
              >
                <span
                  className={`w-2 h-2 rounded-full mt-[5px] flex-shrink-0 shadow-sm ${s.dot}`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-gray-300 leading-relaxed line-clamp-2 group-hover:text-white transition-colors">
                    {article.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-gray-600 font-mono font-medium">
                      {timeAgo(article.publishedAt)}
                    </span>
                    <span className="w-0.5 h-0.5 rounded-full bg-gray-700" />
                    <span className="text-[10px] text-gray-500 font-medium truncate">
                      {article.source}
                    </span>
                    <ExternalLink className="w-2.5 h-2.5 text-gray-700 group-hover:text-gray-500 transition-colors ml-auto flex-shrink-0" />
                  </div>
                </div>
              </a>
            );
          })
        )}
      </div>
    </div>
  );
}
