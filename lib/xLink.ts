export function xLinkMessage(authorId: string, wallet: string): Uint8Array {
  return new TextEncoder().encode([
    'Yosuku X account link',
    `X user: ${authorId}`,
    `Wallet: ${wallet.toLowerCase()}`,
  ].join('\n'));
}

