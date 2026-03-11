'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { MessageCircle, Send, Trash2 } from 'lucide-react';

interface Comment {
  id: string;
  address: string;
  text: string;
  timestamp: number;
  roundId: number;
}

interface CommentsProps {
  roundId: number;
}

const STORAGE_KEY = 'pred_comments';

function shortAddr(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Comments({ roundId }: CommentsProps) {
  const { address } = useWallet();
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');

  // Load comments from localStorage
  useEffect(() => {
    try {
      const saved: Comment[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      setComments(saved);
    } catch {
      // ignore
    }
  }, []);

  const save = (updated: Comment[]) => {
    setComments(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const handlePost = () => {
    if (!text.trim() || !address) return;

    const comment: Comment = {
      id: crypto.randomUUID(),
      address: address,
      text: text.trim(),
      timestamp: Date.now(),
      roundId,
    };

    save([comment, ...comments]);
    setText('');
  };

  const handleDelete = (id: string) => {
    save(comments.filter(c => c.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handlePost();
    }
  };

  // Show all comments, not filtered by round (community feed)
  const displayed = comments.slice(0, 50);

  return (
    <div className="bg-black/80 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-gray-500" />
        <span className="text-xs font-black text-gray-400 uppercase tracking-widest">
          Comments
        </span>
        <span className="text-[10px] font-mono text-gray-600 ml-1">
          ({displayed.length})
        </span>
      </div>

      {/* Post input */}
      <div className="px-5 py-3 border-b border-white/5">
        {address ? (
          <div className="flex gap-2">
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-new-mint/20 to-new-blue/20 border border-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-[10px] font-mono font-bold text-gray-400">
                {address.slice(5, 7).toUpperCase()}
              </span>
            </div>

            <div className="flex-1 relative">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Add a comment..."
                rows={1}
                className="w-full bg-black/45 border border-white/5 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-white/15 focus:outline-none resize-none transition-all"
              />
            </div>

            <button
              onClick={handlePost}
              disabled={!text.trim()}
              className="self-end px-3 py-2.5 rounded-xl bg-new-mint/15 text-new-mint text-xs font-bold hover:bg-new-mint/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <p className="text-xs text-gray-600 text-center py-1">Connect wallet to comment</p>
        )}
      </div>

      {/* Comments list */}
      <div className="max-h-[400px] overflow-y-auto">
        {displayed.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-xs text-gray-600">No comments yet. Be the first!</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {displayed.map((c) => (
              <div key={c.id} className="px-5 py-3 hover:bg-white/[0.02] transition-colors group">
                <div className="flex items-start gap-2.5">
                  {/* Avatar */}
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-white/5 to-white/10 border border-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-[9px] font-mono font-bold text-gray-500">
                      {c.address.slice(5, 7).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px] font-mono font-bold text-gray-400">
                        {shortAddr(c.address)}
                      </span>
                      <span className="text-[10px] text-gray-600">{timeAgo(c.timestamp)}</span>
                      {c.roundId > 0 && (
                        <span className="text-[9px] font-mono text-gray-700">#{c.roundId}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed break-words">{c.text}</p>
                  </div>

                  {/* Delete own comments */}
                  {address === c.address && (
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-600 hover:text-off-red transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
