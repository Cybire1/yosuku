export default function Footer() {
    return (
        <footer className="w-full border-t border-white/5 bg-black pt-16 pb-8 px-6 sm:px-12 md:px-[50px]">
            <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-10">

                {/* Brand */}
                <div className="flex flex-col gap-4">
                    <h2 className="text-3xl font-black tracking-tighter text-white">DART</h2>
                    <p className="text-zinc-500 text-sm max-w-xs leading-relaxed">
                        The fully-private, cryptographically verified prediction market running exclusively on the Aleo network.
                    </p>
                </div>

                {/* Links */}
                <div className="flex flex-wrap gap-x-12 gap-y-8">
                    <div className="flex flex-col gap-3">
                        <span className="text-white font-bold tracking-widest text-xs uppercase mb-1">Platform</span>
                        <a href="/markets" className="text-zinc-400 hover:text-white transition-colors text-sm">Markets</a>
                        <a href="#" className="text-zinc-400 hover:text-white transition-colors text-sm">Leaderboard</a>
                        <a href="#" className="text-zinc-400 hover:text-white transition-colors text-sm">Claim DART</a>
                    </div>

                    <div className="flex flex-col gap-3">
                        <span className="text-white font-bold tracking-widest text-xs uppercase mb-1">Resources</span>
                        <a href="#" className="text-zinc-400 hover:text-white transition-colors text-sm">Documentation</a>
                        <a href="#" className="text-zinc-400 hover:text-white transition-colors text-sm">Aleo Network</a>
                        <a href="#" className="text-zinc-400 hover:text-white transition-colors text-sm">GitHub</a>
                    </div>

                    <div className="flex flex-col gap-3">
                        <span className="text-white font-bold tracking-widest text-xs uppercase mb-1">Social</span>
                        <a href="#" className="text-zinc-400 hover:text-white transition-colors text-sm">Twitter / X</a>
                        <a href="#" className="text-zinc-400 hover:text-white transition-colors text-sm">Discord</a>
                    </div>
                </div>
            </div>

            {/* Bottom Bar */}
            <div className="max-w-7xl mx-auto mt-20 pt-8 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-4">
                <p className="text-xs text-zinc-600">
                    &copy; {new Date().getFullYear()} DART Protocol. All rights reserved.
                </p>
                <div className="flex items-center gap-6">
                    <a href="#" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Privacy Policy</a>
                    <a href="#" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Terms of Service</a>
                </div>
            </div>

            {/* Massive Brutalist Anchor */}
            <div className="w-full flex justify-center mt-12 overflow-hidden pointer-events-none select-none">
                <h1 className="text-[25vw] font-black tracking-tighter text-zinc-800/20 leading-[0.75] m-0 p-0">
                    DART
                </h1>
            </div>
        </footer>
    );
}
