export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-row">
          <span>© 2026 YOSUKU · 予測 · Sui Testnet</span>
          <span style={{ color: 'var(--gray-600)' }}>v0.4.1 · status: nominal</span>
          <span>
            <a href="#" data-cursor="hover">Docs</a>
            {' · '}
            <a href="#" data-cursor="hover">Suiscan ↗</a>
            {' · '}
            <a href="#" data-cursor="hover">Brand</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
