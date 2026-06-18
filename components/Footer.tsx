export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-row">
          <span>© 2026 YOSUKU · 予測 · Sui Testnet</span>
          <span style={{ color: 'var(--gray-600)' }}>Testnet preview</span>
          <span>
            <a href="/docs" data-cursor="hover">Docs</a>
            {' · '}
            <a
              href="https://suiscan.xyz/testnet/object/0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138"
              target="_blank"
              rel="noopener noreferrer"
              data-cursor="hover"
            >Suiscan ↗</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
