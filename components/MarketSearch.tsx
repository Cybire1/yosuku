'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Clock, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Market } from './MarketCard';
import { searchMarkets, getRecentSearches, saveRecentSearch, clearRecentSearches, getSearchSuggestions } from '@/lib/searchUtils';

interface MarketSearchProps {
  markets: Market[];
  onSearch: (query: string, results: Market[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export default function MarketSearch({
  markets,
  onSearch,
  placeholder = 'Search markets...',
  autoFocus = false,
  className = ''
}: MarketSearchProps) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load recent searches and suggestions on mount
  useEffect(() => {
    setRecentSearches(getRecentSearches());
    setSuggestions(getSearchSuggestions(markets));
  }, [markets]);

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const results = searchMarkets(markets, query);
      onSearch(query, results);
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [query, markets, onSearch]);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }

      // Escape to clear/close
      if (e.key === 'Escape') {
        setQuery('');
        setShowSuggestions(false);
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    setShowSuggestions(value.length > 0 || isFocused);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    saveRecentSearch(suggestion);
    setRecentSearches([suggestion, ...recentSearches.filter(s => s !== suggestion)].slice(0, 5));
    setShowSuggestions(false);
    inputRef.current?.blur();
  };

  const handleClear = () => {
    setQuery('');
    onSearch('', markets);
    setShowSuggestions(false);
  };

  const handleClearRecent = () => {
    clearRecentSearches();
    setRecentSearches([]);
  };

  const handleFocus = () => {
    setIsFocused(true);
    setShowSuggestions(true);
  };

  const handleBlur = () => {
    // Delay to allow clicking suggestions
    setTimeout(() => {
      setIsFocused(false);
      setShowSuggestions(false);
    }, 200);
  };

  return (
    <div className={`relative ${className}`}>
      {/* Search Input */}
      <div className="relative group">
        {/* Glow effect on focus */}
        <div className="absolute -inset-0.5 bg-gradient-to-r from-new-mint to-new-blue opacity-0 group-focus-within:opacity-30 blur transition-opacity duration-500 rounded-2xl" />

        {/* Input Container */}
        <div className="relative flex items-center">
          <div className="absolute inset-0 bg-neutral-900/80 backdrop-blur-2xl border border-white/10 group-focus-within:border-white/20 rounded-2xl transition-all" />

          {/* Search Icon */}
          <div className="absolute left-5 z-10">
            <Search className={`w-5 h-5 transition-colors ${isFocused ? 'text-new-mint' : 'text-gray-500'}`} />
          </div>

          {/* Input Field */}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={placeholder}
            autoFocus={autoFocus}
            className="relative w-full bg-transparent pl-14 pr-24 py-4 text-white placeholder-gray-600 focus:outline-none text-sm font-medium z-10"
          />

          {/* Keyboard Hint */}
          {!query && !isFocused && (
            <div className="absolute right-5 z-10 flex items-center gap-2">
              <kbd className="px-2 py-1 text-[10px] font-mono bg-white/5 border border-white/10 rounded text-gray-500">
                {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+K
              </kbd>
            </div>
          )}

          {/* Clear Button */}
          {query && (
            <button
              onClick={handleClear}
              className="absolute right-5 z-10 p-1.5 rounded-full hover:bg-white/10 transition-colors group/clear"
            >
              <X className="w-4 h-4 text-gray-500 group-hover/clear:text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Suggestions Dropdown */}
      <AnimatePresence>
        {showSuggestions && (isFocused || query.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full mt-2 w-full z-50"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-neutral-900/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl" />
              <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />

              <div className="relative max-h-[400px] overflow-y-auto rounded-2xl">
                {/* Recent Searches */}
                {!query && recentSearches.length > 0 && (
                  <div className="p-4 border-b border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-gray-500" />
                        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">
                          Recent
                        </span>
                      </div>
                      <button
                        onClick={handleClearRecent}
                        className="text-[10px] font-bold text-gray-500 hover:text-white transition-colors uppercase tracking-wider"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="space-y-1">
                      {recentSearches.map((search, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSuggestionClick(search)}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-sm text-gray-300 hover:text-white"
                        >
                          {search}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Popular Suggestions */}
                {!query && suggestions.length > 0 && (
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp className="w-4 h-4 text-new-mint" />
                      <span className="text-xs font-bold uppercase tracking-widest text-gray-500">
                        Popular
                      </span>
                    </div>
                    <div className="space-y-1">
                      {suggestions.slice(0, 5).map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSuggestionClick(suggestion)}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-sm text-gray-300 hover:text-white"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* No Results */}
                {query && searchMarkets(markets, query).length === 0 && (
                  <div className="p-6 text-center">
                    <p className="text-gray-500 text-sm mb-2">No markets found for "{query}"</p>
                    <p className="text-gray-600 text-xs">Try a different search term</p>
                  </div>
                )}

                {/* Search Results Preview */}
                {query && searchMarkets(markets, query).length > 0 && (
                  <div className="p-4">
                    <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">
                      {searchMarkets(markets, query).length} result{searchMarkets(markets, query).length !== 1 ? 's' : ''}
                    </div>
                    <div className="space-y-1">
                      {searchMarkets(markets, query).slice(0, 5).map((market) => {
                        const total = market.total_yes_shares + market.total_no_shares || 1;
                        const yesOdds = Math.round((market.total_yes_shares / total) * 100);

                        return (
                          <div
                            key={market.id}
                            className="px-3 py-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                          >
                            <p className="text-sm text-white font-medium line-clamp-1 mb-1">
                              {market.question}
                            </p>
                            <div className="flex items-center gap-3 text-xs">
                              <span className="text-gray-500">{market.category}</span>
                              <span className="text-gray-600">•</span>
                              <span className="text-new-mint font-bold">{yesOdds}% YES</span>
                              <span className="text-gray-600">•</span>
                              <span className="text-gray-500">{market.total_volume.toFixed(0)} ALEO</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
